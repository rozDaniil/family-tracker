import type { CircleContact, Member } from "@/lib/types";

export type MemberDisplayInfo = {
  displayName: string;
  systemDisplayName: string;
};

export function buildMemberDisplayMap(
  members: Member[],
  circle: CircleContact[],
): Map<string, MemberDisplayInfo> {
  const circleByMemberId = new Map(circle.map((item) => [item.member_id, item]));
  const result = new Map<string, MemberDisplayInfo>();
  members.forEach((member) => {
    const systemDisplayName = member.display_name;
    const localName = (circleByMemberId.get(member.id)?.nickname ?? "").trim();
    const displayName = localName || systemDisplayName;
    result.set(member.id, { displayName, systemDisplayName });
  });
  return result;
}

export function withMemberDisplayNames(
  members: Member[],
  displayMap: Map<string, MemberDisplayInfo>,
): Member[] {
  return members.map((member) => {
    const display = displayMap.get(member.id);
    if (!display) return member;
    return { ...member, display_name: display.displayName };
  });
}

export function duplicateDisplayIds(
  members: Member[],
  displayMap: Map<string, MemberDisplayInfo>,
): Set<string> {
  const counts = new Map<string, number>();
  members.forEach((member) => {
    const display = displayMap.get(member.id)?.displayName ?? member.display_name;
    const key = display.trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  const ids = new Set<string>();
  members.forEach((member) => {
    const display = displayMap.get(member.id)?.displayName ?? member.display_name;
    const key = display.trim().toLowerCase();
    if ((counts.get(key) ?? 0) > 1) {
      ids.add(member.id);
    }
  });
  return ids;
}

