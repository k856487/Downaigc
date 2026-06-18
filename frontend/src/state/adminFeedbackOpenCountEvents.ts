/** 管理端：待处理反馈数量可能变化时派发，供侧栏 Badge 立即刷新 */
export const ADMIN_OPEN_FEEDBACK_CHANGED = "paper-polish:admin-open-feedback-changed";

export function notifyAdminOpenFeedbackChanged() {
  try {
    window.dispatchEvent(new CustomEvent(ADMIN_OPEN_FEEDBACK_CHANGED));
  } catch {
    /* ignore */
  }
}
