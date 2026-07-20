-- Gift wraps discarded due to local block list (dedupe only; relays may resend).
CREATE TABLE discarded_giftwraps (
    wrapper_id TEXT PRIMARY KEY NOT NULL
);
