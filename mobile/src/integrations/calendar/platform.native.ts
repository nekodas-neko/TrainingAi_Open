import { requireOptionalNativeModule } from 'expo';
import type {
  CalendarService,
} from '../../features/platform/data/CalendarStore';
export const calendarAvailable = () => !!requireOptionalNativeModule('ExpoCalendar');
async function sdk() {
  if (!calendarAvailable())
    throw new Error('Install the latest development build to use calendars.');
  return import('expo-calendar/legacy');
}
export async function calendars(request = false) {
  const calendar = await sdk();
  const permission = request
    ? await calendar.requestCalendarPermissionsAsync()
    : await calendar.getCalendarPermissionsAsync();
  if (!permission.granted)
    throw new Error('Allow calendar access in phone settings to add workout events.');
  return (await calendar.getCalendarsAsync(calendar.EntityTypes.EVENT))
    .filter((row) => row.allowsModifications)
    .map((row) => ({
      id: row.id,
      title: row.title,
      source: row.source?.name ?? row.ownerAccount ?? '',
    }));
}
export const nativeCalendar: CalendarService = {
  async find(calendarId, marker, event) {
    return (
      (
        await (
          await sdk()
        ).getEventsAsync(
          [calendarId],
          new Date(event.start - 86400000),
          new Date(event.end + 86400000),
        )
      ).find((row) => row.notes?.includes(marker))?.id ?? null
    );
  },
  async create(calendarId, event) {
    return (await sdk()).createEventAsync(calendarId, {
      title: event.title,
      notes: event.notes,
      startDate: new Date(event.start),
      endDate: new Date(event.end),
    });
  },
  async update(id, event) {
    await (
      await sdk()
    ).updateEventAsync(id, {
      title: event.title,
      notes: event.notes,
      startDate: new Date(event.start),
      endDate: new Date(event.end),
    });
  },
  async remove(id) {
    await (await sdk()).deleteEventAsync(id);
  },
};
export async function openCalendarEvent(id: string) {
  await (await sdk()).openEventInCalendarAsync({ id });
}
