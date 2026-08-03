pub fn record_session(account_id: &str, access_token: &str) {
    let token_present = !access_token.is_empty();
    tracing::info!(account_id = account_id, token_present = token_present, "session created");
}
