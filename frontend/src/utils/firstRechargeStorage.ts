const KEY_WORD = "downaigc_first_recharge_word_v1";
const KEY_MEMBER = "downaigc_first_recharge_member_v1";

export function hasUsedFirstWordPack(): boolean {
  try {
    return localStorage.getItem(KEY_WORD) === "1";
  } catch {
    return false;
  }
}

export function markFirstWordPackUsed(): void {
  try {
    localStorage.setItem(KEY_WORD, "1");
  } catch {
    /* ignore */
  }
}

export function hasUsedFirstMemberPack(): boolean {
  try {
    return localStorage.getItem(KEY_MEMBER) === "1";
  } catch {
    return false;
  }
}

export function markFirstMemberPackUsed(): void {
  try {
    localStorage.setItem(KEY_MEMBER, "1");
  } catch {
    /* ignore */
  }
}
