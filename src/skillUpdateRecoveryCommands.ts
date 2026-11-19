import * as path from "path";
import * as vscode from "vscode";
import { messages } from "./i18n";
import {
  getSkillRecoveryDirectory,
  hasSkillUpdateRecoveryTarget,
  isSkillUpdateRecoveryInUse,
  listSkillUpdateRecoveries,
  resolveSkillUpdateRecovery,
  SkillUpdateRecoveryInUseError,
  SkillUpdateRecoveryTargetMissingError,
  type SkillUpdateRecoveryRecord,
} from "./skillUpdateRecovery";

const RECOVERY_NOTICE_KEY = "skillNinja.recoveryNoticeFingerprint";
const REVIEW_COMMAND = "skillNinja.reviewInterruptedUpdates";

interface RecoveryItem extends vscode.QuickPickItem {
  record: SkillUpdateRecoveryRecord;
}

export function registerSkillRecoveryCommand(
  context: vscode.ExtensionContext,
  channel: vscode.OutputChannel,
): vscode.Disposable {
  return vscode.commands.registerCommand(REVIEW_COMMAND, async () => {
    let records: SkillUpdateRecoveryRecord[];
    try {
      records = await listSkillUpdateRecoveries(context);
    } catch {
      let directory: string | undefined;
      try {
        directory = getSkillRecoveryDirectory(context);
        channel.appendLine(`${messages.recoveryRecordsLabel()}: ${directory}`);
      } catch {
        channel.appendLine(messages.recoveryStoreUnavailable());
      }
      channel.show(true);
      const open = messages.recoveryOpenRecordsAction();
      const choice = await vscode.window.showErrorMessage(
        messages.recoveryStoreUnavailable(),
        ...(directory ? [open] : []),
      );
      if (directory && choice === open) {
        try {
          await vscode.commands.executeCommand(
            "revealFileInOS",
            vscode.Uri.file(directory),
          );
        } catch {
          void vscode.window.showErrorMessage(messages.recoveryResolveFailed());
        }
      }
      return;
    }

    if (records.length === 0) {
      void vscode.window.showInformationMessage(messages.recoveryNone());
      return;
    }
    const items: RecoveryItem[] = records.map((record) => ({
      label: path.basename(record.targetPath),
      description: record.startedAt,
      detail: record.targetPath,
      record,
    }));
    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: messages.recoveryPickerPlaceholder(),
    });
    if (!selected) {
      return;
    }
    const { record } = selected;
    channel.appendLine(`${messages.recoveryTargetLabel()}: ${record.targetPath}`);
    channel.appendLine(`${messages.recoveryBackupLabel()}: ${record.backupPath}`);
    channel.appendLine(
      `${messages.recoveryTransactionLabel()}: ${record.transactionPath}`,
    );
    channel.show(true);
    try {
      if (isSkillUpdateRecoveryInUse(record)) {
        throw new SkillUpdateRecoveryInUseError();
      }
      if (!(await hasSkillUpdateRecoveryTarget(record))) {
        throw new SkillUpdateRecoveryTargetMissingError();
      }
      const action = messages.recoveryResolveAction();
      const choice = await vscode.window.showWarningMessage(
        messages.recoveryConfirm(),
        { modal: true },
        action,
      );
      if (choice !== action) {
        return;
      }
      await resolveSkillUpdateRecovery(context, record);
      try {
        await context.globalState.update(RECOVERY_NOTICE_KEY, undefined);
      } catch {
        console.warn("[Skill Ninja] Failed to clear the recovery notification state");
      }
      void vscode.window.showInformationMessage(messages.recoveryResolved());
    } catch (error) {
      const message =
        error instanceof SkillUpdateRecoveryInUseError
          ? messages.recoveryInUse()
          : error instanceof SkillUpdateRecoveryTargetMissingError
            ? messages.recoveryMissingTarget()
            : messages.recoveryResolveFailed();
      void vscode.window.showErrorMessage(message);
    }
  });
}

export async function notifyInterruptedSkillUpdates(
  context: vscode.ExtensionContext,
  isActive: () => boolean,
): Promise<void> {
  let fingerprint: string;
  let message: string;
  try {
    const records = (await listSkillUpdateRecoveries(context)).filter(
      (record) => !isSkillUpdateRecoveryInUse(record),
    );
    if (records.length === 0) {
      if (isActive() && context.globalState.get<string>(RECOVERY_NOTICE_KEY) !== undefined) {
        try {
          await context.globalState.update(RECOVERY_NOTICE_KEY, undefined);
        } catch {
          console.warn("[Skill Ninja] Failed to clear the recovery notification state");
        }
      }
      return;
    }
    fingerprint = records.map((record) => record.id).sort().join(",");
    message = messages.recoveryStartup(records.length);
  } catch {
    fingerprint = "unreadable";
    message = messages.recoveryStoreUnavailable();
  }
  if (!isActive() || context.globalState.get<string>(RECOVERY_NOTICE_KEY) === fingerprint) {
    return;
  }
  try {
    await context.globalState.update(RECOVERY_NOTICE_KEY, fingerprint);
  } catch {
    console.warn("[Skill Ninja] Failed to remember the recovery notification");
  }
  if (!isActive()) {
    return;
  }
  const action = messages.recoveryReviewAction();
  void vscode.window.showWarningMessage(message, action).then((choice) => {
    if (choice === action && isActive()) {
      void vscode.commands.executeCommand(REVIEW_COMMAND);
    }
  });
}
