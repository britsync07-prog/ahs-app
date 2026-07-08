use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug)]
struct TestConfig {
    pub onboarded: bool,
    pub existing_field: Option<String>,
    pub new_field: Option<String>,
}

fn main() {
    let old_json = r#"{"onboarded": true, "existing_field": "hello"}"#;
    let result: Result<TestConfig, _> = serde_json::from_str(old_json);
    println!("{:?}", result);
}
