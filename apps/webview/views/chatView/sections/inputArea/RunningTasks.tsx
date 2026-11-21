import type { RunningTaskInfo } from "@/contracts";
import { t } from "@webview/i18n";
import "./RunningTasks.css";

type Props = {
  tasks: readonly RunningTaskInfo[];
  stopping?: ReadonlySet<string>;
  onStop: (task: RunningTaskInfo) => void;
};

function RunningTasks({ tasks, stopping, onStop }: Props) {
  if (tasks.length === 0) {
    return null;
  }

  return (
    <div className="runningTasks" role="group" aria-label={t("chat.runningTasks")}>
      {tasks.map((task) => {
        const pending = stopping?.has(task.id) ?? false;
        return (
          <div className="runningTask" key={task.id}>
            <span className="runningTaskLabel" title={[task.command, task.cwd].filter(Boolean).join("\n")}>
              <span className="runningTaskName">{task.name}</span>
              {task.pid === undefined ? null : <span className="runningTaskPid">({task.pid})</span>}
            </span>
            <button
              type="button"
              className="runningTaskStop"
              disabled={pending}
              aria-label={t("chat.stopRunningTask", { name: task.name })}
              data-tooltip={pending ? t("chat.stoppingRunningTask") : t("chat.stopRunningTaskHint")}
              data-tooltip-align="end"
              onClick={() => onStop(task)}
            >
              <span
                className={`codicon ${pending ? "codicon-loading codicon-modifier-spin" : "codicon-debug-stop"}`}
                aria-hidden="true"
              />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default RunningTasks;
