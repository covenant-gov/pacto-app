use jni::signature::JavaType;
use jni::JNIEnv;
use std::sync::{Arc, Mutex};

static PERMISSION_RESULT: Mutex<Option<bool>> = Mutex::new(None);
static PERMISSION_NOTIFY: std::sync::Condvar = std::sync::Condvar::new();

pub fn check_audio_permission() -> Result<bool, String> {
    ndk_context::android_context().vm().with_env(|env, _| {
        let cls = env
            .find_class("org/covenantgovernance/pacto/Permissions")
            .map_err(|e| format!("failed to find Permissions class: {e:?}"))?;
        let res = env
            .call_static_method(
                &cls,
                "checkAudioPermission",
                JavaType::from_str("()Z").map_err(|e| e.to_string())?,
                &[],
            )
            .map_err(|e| format!("checkAudioPermission failed: {e:?}"))?;
        res.z().map_err(|e| e.to_string())
    })
}

pub fn request_audio_permission_blocking() -> Result<bool, String> {
    ndk_context::android_context().vm().with_env(|env, _| {
        let cls = env
            .find_class("org/covenantgovernance/pacto/Permissions")
            .map_err(|e| format!("failed to find Permissions class: {e:?}"))?;
        env.call_static_method(
            &cls,
            "requestAudioPermission",
            JavaType::from_str("()V").map_err(|e| e.to_string())?,
            &[],
        )
        .map_err(|e| format!("requestAudioPermission failed: {e:?}"))?;
        Ok(())
    })?;

    let mut guard = PERMISSION_RESULT
        .lock()
        .map_err(|_| "permission mutex poisoned".to_string())?;
    loop {
        match guard.take() {
            Some(granted) => return Ok(granted),
            None => {
                guard = PERMISSION_NOTIFY
                    .wait(guard)
                    .map_err(|_| "permission condvar wait failed".to_string())?;
            }
        }
    }
}

#[allow(dead_code)]
pub(crate) fn set_permission_result(granted: bool) {
    if let Ok(mut guard) = PERMISSION_RESULT.lock() {
        *guard = Some(granted);
        PERMISSION_NOTIFY.notify_one();
    }
}
