/**
 * Simple ICS (iCalendar) parser for extracting event details
 */

export interface IcsEvent {
  summary: string | null
  description: string | null
  location: string | null
  startDate: Date | null
  endDate: Date | null
  organizer: string | null
  attendees: string[]
  uid: string | null
  status: string | null
  url: string | null
}

/**
 * Parse ICS date string to Date object
 * Supports formats like:
 * - 20251217T140000Z (UTC)
 * - 20251217T140000 (local)
 * - 20251217 (date only)
 * - TZID=America/New_York:20251217T140000
 */
function parseIcsDate(value: string | null): Date | null {
  if (!value) return null

  // Handle TZID prefix
  if (value.includes(':')) {
    value = value.split(':').pop() || value
  }

  // Remove any remaining parameters
  value = value.trim()

  // Date only format: YYYYMMDD
  if (/^\d{8}$/.test(value)) {
    const year = parseInt(value.slice(0, 4))
    const month = parseInt(value.slice(4, 6)) - 1
    const day = parseInt(value.slice(6, 8))
    return new Date(year, month, day)
  }

  // DateTime format: YYYYMMDDTHHMMSS or YYYYMMDDTHHMMSSZ
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/)
  if (match) {
    const [, year, month, day, hour, minute, second, isUtc] = match
    if (isUtc) {
      return new Date(Date.UTC(
        parseInt(year!),
        parseInt(month!) - 1,
        parseInt(day!),
        parseInt(hour!),
        parseInt(minute!),
        parseInt(second!)
      ))
    }
    return new Date(
      parseInt(year!),
      parseInt(month!) - 1,
      parseInt(day!),
      parseInt(hour!),
      parseInt(minute!),
      parseInt(second!)
    )
  }

  return null
}

/**
 * Decode ICS escaped text
 */
function decodeIcsText(text: string | null): string | null {
  if (!text) return null
  return text
    .replace(/\\n/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
}

/**
 * Parse an ICS file content and extract events
 */
export function parseIcs(content: string): IcsEvent[] {
  const events: IcsEvent[] = []

  // Unfold lines (lines that start with space/tab are continuations)
  const unfolded = content.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '')

  // Split into lines
  const lines = unfolded.split(/\r\n|\n/)

  let inEvent = false
  let currentEvent: Partial<IcsEvent> = {}
  const attendees: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed === 'BEGIN:VEVENT') {
      inEvent = true
      currentEvent = {}
      attendees.length = 0
      continue
    }

    if (trimmed === 'END:VEVENT') {
      inEvent = false
      events.push({
        summary: currentEvent.summary || null,
        description: currentEvent.description || null,
        location: currentEvent.location || null,
        startDate: currentEvent.startDate || null,
        endDate: currentEvent.endDate || null,
        organizer: currentEvent.organizer || null,
        attendees: [...attendees],
        uid: currentEvent.uid || null,
        status: currentEvent.status || null,
        url: currentEvent.url || null,
      })
      continue
    }

    if (!inEvent) continue

    // Parse property
    const colonIndex = trimmed.indexOf(':')
    if (colonIndex === -1) continue

    const propertyPart = trimmed.slice(0, colonIndex)
    const value = trimmed.slice(colonIndex + 1)

    // Get property name (before any parameters)
    const semicolonIndex = propertyPart.indexOf(';')
    const propertyName = semicolonIndex === -1
      ? propertyPart.toUpperCase()
      : propertyPart.slice(0, semicolonIndex).toUpperCase()

    switch (propertyName) {
      case 'SUMMARY':
        currentEvent.summary = decodeIcsText(value)
        break
      case 'DESCRIPTION':
        currentEvent.description = decodeIcsText(value)
        break
      case 'LOCATION':
        currentEvent.location = decodeIcsText(value)
        break
      case 'DTSTART':
        currentEvent.startDate = parseIcsDate(value)
        break
      case 'DTEND':
        currentEvent.endDate = parseIcsDate(value)
        break
      case 'ORGANIZER':
        // Extract email from MAILTO: or CN parameter
        if (value.toLowerCase().startsWith('mailto:')) {
          currentEvent.organizer = value.slice(7)
        } else {
          const cnMatch = propertyPart.match(/CN=([^;]+)/i)
          currentEvent.organizer = cnMatch ? cnMatch[1] : value
        }
        break
      case 'ATTENDEE':
        if (value.toLowerCase().startsWith('mailto:')) {
          attendees.push(value.slice(7))
        } else {
          const cnMatch = propertyPart.match(/CN=([^;]+)/i)
          attendees.push(cnMatch?.[1] ?? value)
        }
        break
      case 'UID':
        currentEvent.uid = value
        break
      case 'STATUS':
        currentEvent.status = value
        break
      case 'URL':
        currentEvent.url = value
        break
    }
  }

  return events
}

/**
 * Check if an attachment is an ICS file
 */
export function isIcsAttachment(mimeType: string | null, filename: string): boolean {
  if (mimeType === 'text/calendar' || mimeType === 'application/ics') {
    return true
  }
  return filename.toLowerCase().endsWith('.ics')
}

/**
 * Format date for display
 */
export function formatEventDate(date: Date | null): string {
  if (!date) return ''
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Format time for display
 */
export function formatEventTime(date: Date | null): string {
  if (!date) return ''
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * Format date range for display
 */
export function formatEventDateRange(start: Date | null, end: Date | null): string {
  if (!start) return ''

  const startDate = formatEventDate(start)
  const startTime = formatEventTime(start)

  if (!end) {
    return `${startDate} at ${startTime}`
  }

  const endDate = formatEventDate(end)
  const endTime = formatEventTime(end)

  // Same day
  if (startDate === endDate) {
    return `${startDate}, ${startTime} - ${endTime}`
  }

  return `${startDate} ${startTime} - ${endDate} ${endTime}`
}

/**
 * Generate Google Calendar URL for an event
 */
export function generateGoogleCalendarUrl(event: IcsEvent): string {
  const params = new URLSearchParams()
  params.set('action', 'TEMPLATE')

  if (event.summary) {
    params.set('text', event.summary)
  }

  if (event.startDate) {
    const formatGoogleDate = (d: Date) => {
      return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
    }
    let dates = formatGoogleDate(event.startDate)
    if (event.endDate) {
      dates += '/' + formatGoogleDate(event.endDate)
    } else {
      // Default to 1 hour if no end date
      const endDate = new Date(event.startDate.getTime() + 60 * 60 * 1000)
      dates += '/' + formatGoogleDate(endDate)
    }
    params.set('dates', dates)
  }

  if (event.location) {
    params.set('location', event.location)
  }

  if (event.description) {
    params.set('details', event.description)
  }

  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

/**
 * Generate Outlook.com calendar URL for an event
 */
export function generateOutlookCalendarUrl(event: IcsEvent): string {
  const params = new URLSearchParams()
  params.set('path', '/calendar/action/compose')
  params.set('rru', 'addevent')

  if (event.summary) {
    params.set('subject', event.summary)
  }

  if (event.startDate) {
    params.set('startdt', event.startDate.toISOString())
  }

  if (event.endDate) {
    params.set('enddt', event.endDate.toISOString())
  }

  if (event.location) {
    params.set('location', event.location)
  }

  if (event.description) {
    params.set('body', event.description)
  }

  return `https://outlook.live.com/calendar/0/action/compose?${params.toString()}`
}
