pub fn record_session(account_id: &str, access_token: &str) {
    tracing::info!(account_id = account_id, access_token = access_token, "session created");
}
