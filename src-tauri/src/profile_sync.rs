use crate::{current_login_generation, get_nostr_client, profile, STATE};
use lazy_static::lazy_static;
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

/// Priority levels for profile syncing
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub enum SyncPriority {
    Critical, // No metadata OR user clicked - fetch immediately
    High,     // Active chats - fetch soon
    Medium,   // Recent chats - fetch eventually
    Low,      // Old chats with metadata - passive refresh
}

impl SyncPriority {
    /// Returns the cache window duration for this priority level
    pub fn cache_window(&self) -> Duration {
        match self {
            SyncPriority::Critical => Duration::from_secs(0), // No cache, always fetch
            SyncPriority::High => Duration::from_secs(5 * 60), // 5 minutes
            SyncPriority::Medium => Duration::from_secs(30 * 60), // 30 minutes
            SyncPriority::Low => Duration::from_secs(24 * 60 * 60), // 24 hours
        }
    }

    /// Returns the processing delay before fetching
    pub fn processing_delay(&self) -> Duration {
        match self {
            SyncPriority::Critical => Duration::from_secs(0), // Immediate
            SyncPriority::High => Duration::from_secs(5),     // 5 seconds
            SyncPriority::Medium => Duration::from_secs(30),  // 30 seconds
            SyncPriority::Low => Duration::from_secs(5 * 60), // 5 minutes
        }
    }

    /// Returns the maximum batch size for this priority
    pub fn batch_size(&self) -> usize {
        match self {
            SyncPriority::Critical => 10, // Process critical profiles quickly
            SyncPriority::High => 20,     // Moderate batch for active chats
            SyncPriority::Medium => 30,   // Larger batch for recent chats
            SyncPriority::Low => 50,      // Large batch for passive refresh
        }
    }
}

/// Entry in the sync queue
#[derive(Debug, Clone)]
pub(crate) struct QueueEntry {
    npub: String,
    added_at: Instant,
}

/// Profile sync queue manager
pub struct ProfileSyncQueue {
    // Separate queues for each priority level
    critical_queue: VecDeque<QueueEntry>,
    high_queue: VecDeque<QueueEntry>,
    medium_queue: VecDeque<QueueEntry>,
    low_queue: VecDeque<QueueEntry>,

    // Track profiles currently being processed
    processing: HashSet<String>,

    // Track when profiles were last fetched
    last_fetched: HashMap<String, Instant>,

    // Background processor state
    is_processing: bool,
}

impl ProfileSyncQueue {
    pub fn new() -> Self {
        Self {
            critical_queue: VecDeque::new(),
            high_queue: VecDeque::new(),
            medium_queue: VecDeque::new(),
            low_queue: VecDeque::new(),
            processing: HashSet::new(),
            last_fetched: HashMap::new(),
            is_processing: false,
        }
    }

    /// Add a profile to the sync queue
    pub fn add(&mut self, npub: String, priority: SyncPriority, force_refresh: bool) {
        // Check if already processing
        if self.processing.contains(&npub) {
            return;
        }

        // Check cache window (unless force_refresh)
        if !force_refresh {
            if let Some(last_fetch) = self.last_fetched.get(&npub) {
                let cache_window = priority.cache_window();
                if last_fetch.elapsed() < cache_window {
                    // Still within cache window, skip
                    return;
                }
            }
        }

        // Remove from all other queues (deduplication)
        self.remove_from_all_queues(&npub);

        // Add to appropriate queue
        let entry = QueueEntry {
            npub,
            added_at: Instant::now(),
        };

        match priority {
            SyncPriority::Critical => self.critical_queue.push_back(entry),
            SyncPriority::High => self.high_queue.push_back(entry),
            SyncPriority::Medium => self.medium_queue.push_back(entry),
            SyncPriority::Low => self.low_queue.push_back(entry),
        }
    }

    /// Remove an npub from all queues (deduplication helper)
    fn remove_from_all_queues(&mut self, npub: &str) {
        self.critical_queue.retain(|e| e.npub != npub);
        self.high_queue.retain(|e| e.npub != npub);
        self.medium_queue.retain(|e| e.npub != npub);
        self.low_queue.retain(|e| e.npub != npub);
    }

    fn queue_mut(&mut self, priority: SyncPriority) -> &mut VecDeque<QueueEntry> {
        match priority {
            SyncPriority::Critical => &mut self.critical_queue,
            SyncPriority::High => &mut self.high_queue,
            SyncPriority::Medium => &mut self.medium_queue,
            SyncPriority::Low => &mut self.low_queue,
        }
    }

    fn queue(&self, priority: SyncPriority) -> &VecDeque<QueueEntry> {
        match priority {
            SyncPriority::Critical => &self.critical_queue,
            SyncPriority::High => &self.high_queue,
            SyncPriority::Medium => &self.medium_queue,
            SyncPriority::Low => &self.low_queue,
        }
    }

    /// Ready work above `current` should run before the rest of a lower batch.
    pub(crate) fn has_ready_higher_priority(&self, current: SyncPriority) -> bool {
        let above: &[SyncPriority] = match current {
            SyncPriority::Critical => &[],
            SyncPriority::High => &[SyncPriority::Critical],
            SyncPriority::Medium => &[SyncPriority::Critical, SyncPriority::High],
            SyncPriority::Low => &[
                SyncPriority::Critical,
                SyncPriority::High,
                SyncPriority::Medium,
            ],
        };
        above.iter().any(|priority| {
            let delay = priority.processing_delay();
            self.queue(*priority)
                .iter()
                .any(|entry| entry.added_at.elapsed() >= delay)
        })
    }

    /// Put an unprocessed entry back at the front of its queue.
    pub(crate) fn requeue_front(&mut self, entry: QueueEntry, priority: SyncPriority) {
        self.processing.remove(&entry.npub);
        self.queue_mut(priority).push_front(entry);
    }

    /// Get the next batch of profiles to process.
    pub fn take_next_batch(&mut self) -> Option<(Vec<QueueEntry>, SyncPriority)> {
        let priority = if !self.critical_queue.is_empty() {
            SyncPriority::Critical
        } else if !self.high_queue.is_empty() {
            SyncPriority::High
        } else if !self.medium_queue.is_empty() {
            SyncPriority::Medium
        } else if !self.low_queue.is_empty() {
            SyncPriority::Low
        } else {
            return None;
        };

        let batch_size = priority.batch_size();
        let processing_delay = priority.processing_delay();
        let mut batch = Vec::new();
        let queue = self.queue_mut(priority);

        while batch.len() < batch_size {
            let ready = queue
                .front()
                .is_some_and(|entry| entry.added_at.elapsed() >= processing_delay);
            if !ready {
                break;
            }
            let entry = queue.pop_front().unwrap();
            batch.push(entry);
        }

        if batch.is_empty() {
            None
        } else {
            Some((batch, priority))
        }
    }

    /// Mark a profile as currently being processed
    pub fn mark_processing(&mut self, npub: &str) {
        self.processing.insert(npub.to_string());
    }

    /// Mark a profile as done processing
    pub fn mark_done(&mut self, npub: &str) {
        self.processing.remove(npub);
        self.last_fetched.insert(npub.to_string(), Instant::now());
    }
}

// Global profile sync queue
lazy_static! {
    static ref PROFILE_SYNC_QUEUE: Arc<Mutex<ProfileSyncQueue>> =
        Arc::new(Mutex::new(ProfileSyncQueue::new()));
}

/// Background processor that continuously processes the profile sync queue
pub async fn start_profile_sync_processor() {
    let mut last_own_profile_sync = std::time::Instant::now();
    let own_profile_sync_interval = Duration::from_secs(5 * 60); // Sync our own profile every 5 minutes

    loop {
        let _cycle_start = std::time::Instant::now();

        // Periodically queue our own profile to detect changes from other Nostr apps
        if last_own_profile_sync.elapsed() >= own_profile_sync_interval {
            let state = STATE.lock().await;
            if let Some(own_profile) = state.profiles.iter().find(|p| p.mine) {
                let npub = own_profile.id.clone();
                let empty = !own_profile.has_public_metadata();
                drop(state);

                if !empty {
                    if let Ok(client) = get_nostr_client() {
                        let generation = current_login_generation();
                        let expected_npub = npub.clone();
                        let client = (*client).clone();
                        tokio::spawn(async move {
                            profile::maybe_republish_own_kind0(client, expected_npub, generation)
                                .await;
                        });
                    }
                }

                let priority = if empty {
                    SyncPriority::Critical
                } else {
                    SyncPriority::Low
                };
                let mut queue = PROFILE_SYNC_QUEUE.lock().await;
                queue.add(npub.clone(), priority, false);
                drop(queue);
            }
            last_own_profile_sync = std::time::Instant::now();
        }

        // Check if we should process
        let batch = {
            let mut queue = PROFILE_SYNC_QUEUE.lock().await;

            // Prevent multiple processors
            if queue.is_processing {
                drop(queue);
                tokio::time::sleep(Duration::from_secs(1)).await;
                continue;
            }

            queue.is_processing = true;
            let batch = queue.take_next_batch();

            if let Some((ref entries, _)) = batch {
                for entry in entries {
                    queue.mark_processing(&entry.npub);
                }
            }

            batch
        };

        let Some((mut entries, priority)) = batch else {
            {
                let mut queue = PROFILE_SYNC_QUEUE.lock().await;
                queue.is_processing = false;
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
            continue;
        };

        while !entries.is_empty() {
            let preempt = {
                let queue = PROFILE_SYNC_QUEUE.lock().await;
                queue.has_ready_higher_priority(priority)
            };
            if preempt {
                let mut queue = PROFILE_SYNC_QUEUE.lock().await;
                for entry in entries.drain(..) {
                    queue.requeue_front(entry, priority);
                }
                break;
            }

            let entry = entries.remove(0);
            profile::load_profile_and_status(entry.npub.clone()).await;

            {
                let mut queue = PROFILE_SYNC_QUEUE.lock().await;
                queue.mark_done(&entry.npub);
            }

            tokio::time::sleep(Duration::from_millis(100)).await;
        }

        // Release processing lock
        {
            let mut queue = PROFILE_SYNC_QUEUE.lock().await;
            queue.is_processing = false;
        }

        // Small delay before next batch
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}

/// Queue a single profile for syncing
pub async fn queue_profile_sync(npub: String, priority: SyncPriority, force_refresh: bool) {
    let mut queue = PROFILE_SYNC_QUEUE.lock().await;
    queue.add(npub.clone(), priority, force_refresh);
}

/// Queue all profiles for a chat
pub async fn queue_chat_profiles(chat_id: String, is_opening: bool) {
    let state = STATE.lock().await;

    // Find the chat
    let chat = match state.get_chat(&chat_id) {
        Some(c) => c,
        None => return,
    };

    // Determine priority based on chat activity
    let base_priority = if is_opening {
        SyncPriority::High
    } else {
        SyncPriority::Medium
    };

    let mut profiles_to_queue = Vec::new();

    // Queue profiles for all participants
    // Note: chat.participants should be kept up-to-date by the MLS event handlers
    for member_npub in &chat.participants {
        // Empty metadata stays Critical regardless of last_updated (relay miss must retry).
        let has_metadata = state
            .get_profile(member_npub)
            .map(|p| p.has_public_metadata())
            .unwrap_or(false);

        let priority = if !has_metadata {
            SyncPriority::Critical
        } else {
            base_priority
        };

        profiles_to_queue.push((member_npub.clone(), priority));
    }

    drop(state); // Release state lock before queuing

    // Queue all profiles
    let mut queue = PROFILE_SYNC_QUEUE.lock().await;

    for (npub, priority) in profiles_to_queue {
        queue.add(npub.to_string(), priority, is_opening);
    }
}

/// Force immediate refresh of a profile (for user clicks)
pub async fn refresh_profile_now(npub: String) {
    let mut queue = PROFILE_SYNC_QUEUE.lock().await;
    queue.add(npub.clone(), SyncPriority::Critical, true);
}

/// Sync all profiles in the system (replaces old fetchProfiles)
pub async fn sync_all_profiles() {
    let state = STATE.lock().await;

    let mut profiles_to_queue = Vec::new();

    // Queue all profiles with appropriate priority
    for profile in &state.profiles {
        let priority = if !profile.has_public_metadata() {
            SyncPriority::Critical
        } else {
            SyncPriority::Medium
        };

        profiles_to_queue.push((profile.id.clone(), priority));
    }

    drop(state); // Release state lock

    // Queue all profiles
    let mut queue = PROFILE_SYNC_QUEUE.lock().await;

    for (npub, priority) in profiles_to_queue {
        queue.add(npub, priority, true);
    }
}

#[cfg(test)]
mod queue_add_tests {
    use super::*;

    #[test]
    fn force_refresh_bypasses_cache_window() {
        let mut q = ProfileSyncQueue::new();
        q.last_fetched.insert("npub1a".into(), Instant::now());
        q.add("npub1a".into(), SyncPriority::Low, false);
        assert!(q.low_queue.is_empty());
        q.add("npub1a".into(), SyncPriority::Medium, true);
        assert_eq!(q.medium_queue.len(), 1);
    }

    fn push_ready(q: &mut ProfileSyncQueue, npub: &str, priority: SyncPriority) {
        let entry = QueueEntry {
            npub: npub.into(),
            added_at: Instant::now()
                .checked_sub(priority.processing_delay() + Duration::from_secs(1))
                .expect("ready instant"),
        };
        match priority {
            SyncPriority::Critical => q.critical_queue.push_back(entry),
            SyncPriority::High => q.high_queue.push_back(entry),
            SyncPriority::Medium => q.medium_queue.push_back(entry),
            SyncPriority::Low => q.low_queue.push_back(entry),
        }
    }

    #[test]
    fn medium_batch_yields_when_high_is_ready() {
        let mut q = ProfileSyncQueue::new();
        push_ready(&mut q, "m1", SyncPriority::Medium);
        push_ready(&mut q, "m2", SyncPriority::Medium);
        let (batch, priority) = q.take_next_batch().expect("medium batch");
        assert_eq!(priority, SyncPriority::Medium);
        assert_eq!(batch.len(), 2);
        for entry in &batch {
            q.mark_processing(&entry.npub);
        }
        assert!(!q.has_ready_higher_priority(SyncPriority::Medium));
        push_ready(&mut q, "h1", SyncPriority::High);
        assert!(q.has_ready_higher_priority(SyncPriority::Medium));
        q.requeue_front(batch[1].clone(), SyncPriority::Medium);
        assert!(!q.processing.contains("m2"));
        let (next, next_priority) = q.take_next_batch().expect("high batch");
        assert_eq!(next_priority, SyncPriority::High);
        assert_eq!(next[0].npub, "h1");
        assert_eq!(q.medium_queue.front().map(|e| e.npub.as_str()), Some("m2"));
    }
}
