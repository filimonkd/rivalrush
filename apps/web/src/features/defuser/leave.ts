import { confirmDialog } from '../../lib/telegram';
import { useRoom } from '../../store/room';

/** The leave confirmation shared by the Back button and the team drawer (spec 19, mobile rules). */
export async function confirmLeaveTeam(): Promise<boolean> {
  if (!(await confirmDialog("Leave the team? You'll be out of this game."))) return false;
  await useRoom.getState().leave();
  return true;
}
