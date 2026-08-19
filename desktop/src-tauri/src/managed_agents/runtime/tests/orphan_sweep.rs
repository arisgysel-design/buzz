use super::super::process::buzz_marker_entry;

#[test]
fn marker_entry_is_namespaced_by_instance_id() {
    // The spawn stamp and sweep matcher share this on-the-wire format. Namespacing
    // prevents a dev build (`...app.dev`) from matching a release build (`...app`).
    assert_eq!(
        buzz_marker_entry("xyz.block.buzz.app"),
        b"BUZZ_MANAGED_AGENT=xyz.block.buzz.app".to_vec()
    );
    assert_ne!(
        buzz_marker_entry("xyz.block.buzz.app"),
        buzz_marker_entry("xyz.block.buzz.app.dev")
    );
}

/// Subprocess target for the real macOS orphan-sweep regression test below.
#[test]
fn orphan_marker_probe_child() {
    if std::env::var_os("BUZZ_ORPHAN_MARKER_PROBE_CHILD").is_some() {
        std::thread::sleep(std::time::Duration::from_secs(30));
    }
}

/// Proves the abort backstop with a real process: a same-instance child whose
/// harness receipt is absent is observed on the first periodic sweep and its
/// process group is reaped on the confirming second sweep.
#[test]
fn periodic_sweep_reaps_confirmed_same_instance_orphan() {
    use std::collections::HashSet;
    use std::os::unix::process::CommandExt;
    use std::process::{Command, Stdio};

    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock before Unix epoch")
        .as_nanos();
    let instance_id = format!("buzz-orphan-probe-{}-{unique}", std::process::id());
    let mut orphan = Command::new(std::env::current_exe().expect("resolve test executable"))
        .args([
            "--exact",
            "managed_agents::runtime::tests::orphan_sweep::orphan_marker_probe_child",
            "--nocapture",
        ])
        .env("BUZZ_MANAGED_AGENT", &instance_id)
        .env("BUZZ_ORPHAN_MARKER_PROBE_CHILD", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn()
        .expect("spawn marked orphan probe");
    let orphan_pid = orphan.id();
    assert!(
        super::super::process_has_buzz_marker(orphan_pid, &instance_id),
        "orphan probe did not inherit its ownership marker"
    );
    let mut first_seen = HashSet::new();
    for _ in 0..20 {
        first_seen = super::super::orphan_sweep::collect_same_instance_orphans(&instance_id, &[]);
        if first_seen.contains(&orphan_pid) {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    if !first_seen.contains(&orphan_pid) {
        let _ = super::super::terminate_process(orphan_pid);
        let _ = orphan.wait();
        panic!("periodic sweep did not discover marked orphan {orphan_pid}");
    }

    super::super::sweep_system_agent_processes_with_grace(&instance_id, &[], &first_seen);

    let mut reaped = false;
    for _ in 0..50 {
        if orphan.try_wait().expect("poll orphan probe").is_some() {
            reaped = true;
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    if !reaped {
        let _ = super::super::terminate_process(orphan_pid);
        let _ = orphan.wait();
    }
    assert!(
        reaped,
        "confirmed orphan {orphan_pid} survived periodic sweep"
    );
}
