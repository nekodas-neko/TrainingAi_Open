import type { CalendarService } from '../../features/platform/data/CalendarStore';
export const calendarAvailable = () => false;
const unavailable = async (): Promise<never> => {
  throw new Error('Calendar integration requires the native app.');
};
export const calendars = async (
  _request = false,
): Promise<{ id: string; title: string; source: string }[]> => unavailable();
export const nativeCalendar: CalendarService = {
  find: unavailable,
  create: unavailable,
  update: unavailable,
  remove: unavailable,
};
export const openCalendarEvent = async (_id: string) => unavailable();
