use anyhow::Result;
use std::path::PathBuf;

use crate::{
    logging,
    mcp::spirit_agent_data_dir,
    plan,
    ports::{ChatArchive, SubagentSessionSummary},
    rewind,
    ts_bridge::{
        archive::chat_archive_to_bridge_json,
        types::bridge::{
            BridgeDrainEventsResult, BridgeManualToolCommandStartResult, BridgeRuntimeSnapshot,
        },
        PendingApprovalKind, TsBridgeRuntime,
    },
};

impl TsBridgeRuntime {
    pub(crate) fn sync_after_command(&mut self) -> Result<()> {
        let value = self.call_bridge("runtime.drainEvents", None)?;
        let drained: BridgeDrainEventsResult = serde_json::from_value(value)?;
        if !drained.events.is_empty() {
            logging::log_event(&format!(
                "[ts-bridge-host] drain events count={} busy={} approval={} aux={}",
                drained.events.len(),
                drained.snapshot.is_busy,
                drained.snapshot.has_pending_approval,
                drained.snapshot.pending_aux_state.is_some()
            ));
        }
        self.apply_bridge_events(drained.events);
        self.apply_snapshot(drained.snapshot);
        Ok(())
    }

    pub(crate) fn sync_snapshot_only(&mut self) -> Result<()> {
        let value = self.call_bridge("runtime.snapshot", None)?;
        self.apply_snapshot(serde_json::from_value(value)?);
        Ok(())
    }

    pub(crate) fn consume_completed_manual_tool_command_result(&mut self) -> Result<()> {
        let value = self.call_bridge("runtime.takeCompletedManualToolCommandResult", None)?;
        if value.is_null() {
            return Ok(());
        }

        let result: BridgeManualToolCommandStartResult = serde_json::from_value(value)?;
        self.handle_manual_tool_command_result(result);
        Ok(())
    }

    pub(crate) fn replace_runtime_archive(&mut self, archive: &ChatArchive) -> Result<()> {
        if self.bridge_failed {
            return Ok(());
        }
        self.subagent_message_cache.clear();
        self.call_bridge(
            "runtime.replaceFromArchive",
            Some(chat_archive_to_bridge_json(archive)),
        )?;
        self.sync_snapshot_only()
    }

    pub(crate) fn record_host_file_change(&mut self, change: rewind::HostRecordedFileChange) -> Result<()> {
        if change.tool_name == "create_plan" && change.after.exists {
            self.active_plan_path = Some(PathBuf::from(change.resolved_path.clone()));
            self.plan_metadata = plan::plan_metadata_snapshot(
                self.plan_metadata.spirit_agent_mode(),
                self.active_plan_path.as_deref(),
            );
        }

        let spirit_data_dir = spirit_agent_data_dir();
        let stored = rewind::to_desktop_file_change(change, self.rewind.next_sequence());
        rewind::save_rewind_file_change(&spirit_data_dir, &self.rewind.session_id, &stored)?;
        self.rewind
            .file_changes
            .push(rewind::file_change_metadata(&stored));
        self.rewind.file_changes.sort_by_key(|entry| entry.sequence);
        Ok(())
    }

    pub(crate) fn apply_snapshot(&mut self, snapshot: BridgeRuntimeSnapshot) {
        self.session.clear_pending_user_turn();
        self.session.clear_pending_images();
        self.session.clear_pending_mcp_resources();
        self.session.set_loop_enabled(snapshot.loop_enabled);
        self.session
            .set_approval_level(snapshot.approval_level.as_str());
        if let Some(turn) = snapshot.pending_user_turn {
            self.session.set_pending_user_turn(turn);
        }
        for path in snapshot.pending_image_paths {
            self.session.add_pending_image(path);
        }
        for resource in snapshot.pending_mcp_resources {
            self.session.add_pending_mcp_resource(resource);
        }

        self.pending_aux_state = snapshot.pending_aux_state;
        self.current_pending_approval = snapshot.current_pending_approval;
        self.pending_approval_kind = if snapshot.has_pending_approval {
            Some(if snapshot.has_pending_manual_approval {
                PendingApprovalKind::Manual
            } else {
                PendingApprovalKind::Tool
            })
        } else {
            None
        };
        self.child_sessions_cache = snapshot
            .child_sessions
            .into_iter()
            .map(|summary| SubagentSessionSummary {
                session_id: summary.session_id,
                parent_tool_call_id: summary.parent_tool_call_id,
                title: summary.title,
                status: summary.status,
                started_at_unix_ms: summary.started_at_unix_ms,
                updated_at_unix_ms: summary.updated_at_unix_ms,
                completed_at_unix_ms: summary.completed_at_unix_ms,
                latest_message: summary.latest_message,
                final_output: summary.final_output,
                error: summary.error,
            })
            .collect();
        self.subagent_message_cache.retain(|session_id, _| {
            self.child_sessions_cache
                .iter()
                .any(|summary| summary.session_id == *session_id)
        });
        self.pending_questions_active = snapshot.has_pending_questions;
        self.is_busy_cache = snapshot.is_busy;
        self.flush_deferred_transport_replace();
    }

    pub(crate) fn should_poll_bridge(&self) -> bool {
        self.is_busy_cache && self.pending_approval_kind.is_none() && !self.pending_questions_active
    }
}
