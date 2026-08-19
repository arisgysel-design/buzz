use serde::Serialize;
use serde_json::Value;
use std::path::Path;
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use tauri::Manager;

const CONSTRUCT_AGENT_ID: &str = "buzz-writing";
const CONSTRUCT_TOOL_PROFILE: &str = "minimal";

/// Return whether this build enforces owner-only managed-agent access.
#[tauri::command]
pub fn agent_access_owner_only() -> bool {
    crate::managed_agents::owner_only_access_build()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawConstructAccess {
    agent_id: &'static str,
    tool_profile: &'static str,
}

/// Ensure Agent Construct talks to a dedicated OpenClaw identity whose
/// gateway-enforced tool profile exposes only `session_status`.
///
/// The caller must obtain explicit user approval before invoking this command:
/// it writes one isolated agent entry to OpenClaw's own configuration. The
/// operation is idempotent and refuses an existing same-name agent unless its
/// policy is already the expected restricted profile.
#[tauri::command]
pub async fn ensure_openclaw_construct_access(
    app: tauri::AppHandle,
) -> Result<OpenClawConstructAccess, String> {
    let binary = crate::managed_agents::resolve_command("openclaw")
        .ok_or_else(|| "OpenClaw is no longer available on this computer.".to_string())?;
    let workspace = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Couldn't locate Buzz's private data folder: {error}"))?
        .join("openclaw-writing-agent");

    tauri::async_runtime::spawn_blocking(move || ensure_construct_agent(&binary, &workspace))
        .await
        .map_err(|error| format!("OpenClaw access setup stopped unexpectedly: {error}"))??;

    Ok(OpenClawConstructAccess {
        agent_id: CONSTRUCT_AGENT_ID,
        tool_profile: CONSTRUCT_TOOL_PROFILE,
    })
}

fn ensure_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn ensure_construct_agent(binary: &Path, workspace: &Path) -> Result<(), String> {
    let _guard = ensure_lock()
        .lock()
        .map_err(|_| "OpenClaw access setup lock was poisoned.".to_string())?;
    if !binary.is_file() {
        return Err("OpenClaw is no longer available at the discovered path.".to_string());
    }

    let agents = read_agent_config(binary)?;
    if let Some(index) = construct_agent_index(&agents)? {
        return validate_construct_policy(&agents[index]);
    }

    std::fs::create_dir_all(workspace)
        .map_err(|error| format!("Couldn't create the writing bot's private folder: {error}"))?;
    let workspace_text = workspace.to_string_lossy().into_owned();
    run_openclaw(
        binary,
        &[
            "agents",
            "add",
            CONSTRUCT_AGENT_ID,
            "--non-interactive",
            "--workspace",
            &workspace_text,
            "--json",
        ],
    )?;

    let configure_result = configure_construct_policy(binary).and_then(|_| {
        let updated = read_agent_config(binary)?;
        let index = construct_agent_index(&updated)?
            .ok_or_else(|| "OpenClaw did not retain the restricted writing agent.".to_string())?;
        validate_construct_policy(&updated[index])
    });

    if let Err(error) = configure_result {
        let _ = run_openclaw(
            binary,
            &["agents", "delete", CONSTRUCT_AGENT_ID, "--force", "--json"],
        );
        return Err(error);
    }
    Ok(())
}

fn configure_construct_policy(binary: &Path) -> Result<(), String> {
    let agents = read_agent_config(binary)?;
    let index = construct_agent_index(&agents)?
        .ok_or_else(|| "OpenClaw did not create the restricted writing agent.".to_string())?;
    let path = format!("agents.list[{index}].tools");
    let policy = serde_json::json!({
        "profile": CONSTRUCT_TOOL_PROFILE,
        "elevated": { "enabled": false }
    })
    .to_string();
    run_openclaw(binary, &["config", "set", &path, &policy, "--strict-json"])?;
    run_openclaw(binary, &["config", "validate"])?;
    Ok(())
}

fn read_agent_config(binary: &Path) -> Result<Vec<Value>, String> {
    let stdout = run_openclaw(binary, &["config", "get", "agents.list", "--json"])?;
    serde_json::from_str::<Vec<Value>>(&stdout)
        .map_err(|error| format!("OpenClaw returned an unreadable agent list: {error}"))
}

fn construct_agent_index(agents: &[Value]) -> Result<Option<usize>, String> {
    let matches = agents
        .iter()
        .enumerate()
        .filter(|(_, agent)| agent.get("id").and_then(Value::as_str) == Some(CONSTRUCT_AGENT_ID))
        .map(|(index, _)| index)
        .collect::<Vec<_>>();
    match matches.as_slice() {
        [] => Ok(None),
        [index] => Ok(Some(*index)),
        _ => Err("OpenClaw contains duplicate buzz-writing agent entries.".to_string()),
    }
}

fn validate_construct_policy(agent: &Value) -> Result<(), String> {
    let profile = agent
        .get("tools")
        .and_then(|tools| tools.get("profile"))
        .and_then(Value::as_str);
    let elevated = agent
        .get("tools")
        .and_then(|tools| tools.get("elevated"))
        .and_then(|value| value.get("enabled"))
        .and_then(Value::as_bool);
    if profile == Some(CONSTRUCT_TOOL_PROFILE) && elevated == Some(false) {
        return Ok(());
    }
    Err(
        "An existing OpenClaw agent named buzz-writing has broader access. Remove or rename it before creating a Buzz writing bot."
            .to_string(),
    )
}

fn run_openclaw(binary: &Path, args: &[&str]) -> Result<String, String> {
    let mut command = Command::new(binary);
    command.args(args);
    if let Some(path) = crate::managed_agents::readiness::cli_probe::augmented_path() {
        command.env("PATH", path);
    }
    command.stdin(std::process::Stdio::null());
    crate::util::configure_no_window(&mut command);
    let output = command
        .output()
        .map_err(|error| format!("Couldn't run OpenClaw access setup: {error}"))?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
    }
    let detail = String::from_utf8_lossy(&output.stderr)
        .trim()
        .lines()
        .next()
        .unwrap_or("OpenClaw rejected the access setup.")
        .to_string();
    Err(format!("OpenClaw access setup failed: {detail}"))
}

/// Tiny executable-facing probe for release packaging smoke tests. Keeping the
/// probe in the product crate makes it impossible for buzz-releases to validate
/// a copied flag interpretation that has drifted from Desktop's command.
#[doc(hidden)]
pub fn print_agent_access_owner_only_probe_if_requested() -> bool {
    if std::env::args().any(|arg| arg == "--print-agent-access-owner-only") {
        println!("{}", agent_access_owner_only());
        true
    } else {
        false
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    #[test]
    #[ignore = "requires BUZZ_TEST_EXPECTED_AGENT_ACCESS_OWNER_ONLY"]
    fn compiled_policy_matches_expected() {
        let expected = std::env::var("BUZZ_TEST_EXPECTED_AGENT_ACCESS_OWNER_ONLY")
            .expect("BUZZ_TEST_EXPECTED_AGENT_ACCESS_OWNER_ONLY must be set")
            .parse::<bool>()
            .expect("BUZZ_TEST_EXPECTED_AGENT_ACCESS_OWNER_ONLY must be true or false");
        assert_eq!(super::agent_access_owner_only(), expected);
    }

    #[test]
    fn restricted_construct_policy_is_accepted() {
        let agent = json!({
            "id": "buzz-writing",
            "tools": { "profile": "minimal", "elevated": { "enabled": false } }
        });
        assert!(super::validate_construct_policy(&agent).is_ok());
    }

    #[test]
    fn broader_or_elevated_construct_policy_is_refused() {
        for agent in [
            json!({ "id": "buzz-writing" }),
            json!({
                "id": "buzz-writing",
                "tools": { "profile": "full", "elevated": { "enabled": false } }
            }),
            json!({
                "id": "buzz-writing",
                "tools": { "profile": "minimal", "elevated": { "enabled": true } }
            }),
        ] {
            assert!(super::validate_construct_policy(&agent).is_err());
        }
    }

    #[test]
    fn duplicate_construct_agents_are_refused() {
        let agents = vec![
            json!({ "id": "buzz-writing" }),
            json!({ "id": "buzz-writing" }),
        ];
        assert!(super::construct_agent_index(&agents).is_err());
    }
}
