/** 与 TargetCursor 匹配的可交互元素（轻量常量，避免 main 包拉入 gsap） */

export const TARGET_CURSOR_SELECTOR = [

  "a",

  "button",

  "[role='button']",

  ".ant-btn",

  ".galaxy-btn",

  ".cursor-target",

  ".ant-menu-item",

  ".ant-segmented-item",

  ".ant-radio-button-wrapper",

  ".ant-select",

  ".ant-slider",

  ".ant-switch",

  ".upload-preview-box",

  ".upload-gooey-btn",

  ".header-user-avatar",

  ".console-sider-toggle",

  ".login-form-agreement .ant-checkbox",

  ".ad-carousel-slide-btn",

  ".login-page-avatar",

  ".workbench-back-nav-btn",

  ".login-nickname-input",

  ".ant-input-affix-wrapper.input",

  "input.ant-input.input"

].join(", ");



/** 悬停/聚焦时显示文本 I 形光标并隐藏中间圆点 */

export const TARGET_CURSOR_INPUT_SELECTOR = [

  ".login-nickname-input",

  ".ant-input-affix-wrapper.input",

  "input.ant-input.input",

  "textarea.ant-input.input",

  ".upload-paste-textarea",

  ".feedback-rich-editor",

  ".upload-preview-box__body"

].join(", ");


