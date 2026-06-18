/** 输入框四角框选：聚焦 / 拼音组合时保持，其余跟随普通 hover */

export const resolveInputTarget = (
  el: Element | null,
  inputSelector: string
): Element | null => {
  if (!el) return null;
  if (el.matches(inputSelector)) return el;
  return el.closest(inputSelector);
};

export const inputContainsNode = (input: Element, node: Element | null): boolean => {
  if (!node) return false;
  return input === node || input.contains(node);
};

export type InputFrameState = {
  focusedInput: Element | null;
  composingEl: Element | null;
};

export const createInputFrameState = (): InputFrameState => ({
  focusedInput: null,
  composingEl: null
});

/** 拼音候选窗弹出时：锁定框选，忽略 mouseleave / hover 切换 */
export const isInputFrameLocked = (state: InputFrameState): boolean => {
  const { focusedInput, composingEl } = state;
  return !!(focusedInput && composingEl && focusedInput.contains(composingEl));
};

/** DOM 焦点是否仍在该输入框（含 IME 假 focusout） */
export const inputStillFocused = (
  input: Element,
  composingEl: Element | null
): boolean => {
  if (composingEl && inputContainsNode(input, composingEl)) return true;
  const ae = document.activeElement;
  if (!ae || !(ae instanceof HTMLElement)) return false;
  return inputContainsNode(input, ae);
};
