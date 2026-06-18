/** 用户端：「我的反馈」待办数量可能变化时派发，供控制台侧栏角标刷新 */
export const USER_FEEDBACK_PENDING_CHANGED = "paper-polish:user-feedback-pending-changed";

export function notifyUserFeedbackPendingChanged() {
  try {
    window.dispatchEvent(new CustomEvent(USER_FEEDBACK_PENDING_CHANGED));
  } catch {
    /* ignore */
  }
}
