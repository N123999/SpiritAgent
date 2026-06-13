/** 与 `styles.css` 中 `spirit-collapsible-down` 时长一致。 */
export const COLLAPSIBLE_OPEN_ANIMATION_MS = 280;

/** 与 `styles.css` 中 `spirit-collapsible-up` 时长一致。 */
export const COLLAPSIBLE_CLOSE_ANIMATION_MS = 220;

/** 收起动画结束后再卸载重内容（Monaco 等），避免动画中途露底。 */
export const COLLAPSIBLE_CLOSE_UNMOUNT_DELAY_MS = COLLAPSIBLE_CLOSE_ANIMATION_MS + 32;
