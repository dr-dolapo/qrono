# Qrono — Product Requirements Document

*Cleaned-up version of the original Qrono PRD spreadsheet, updated with the decisions made since (platforms, tech stack, permissions matrix, QR031–QR046, broadcast rules, data model). Pricing is deferred until after launch, to be set from real usage. Open questions are tracked in section 11, and post-v1 items in section 12.*

---

## 1. Overview

**What Qrono is:** a collaborative program manager for live events that involve many people.

**Mission:** make running live multi-actor events as smooth as possible, with as little dead air as possible.

### 1.1 Platforms (v1)

Qrono ships on these surfaces in the first version:

| Surface | Technology | Primary users | Purpose |
|---|---|---|---|
| **Mobile app** | Flutter, published to the **Apple App Store** and **Google Play Store** | Participants (any role) during a live event | A simple, native way to follow the event on a phone: the program, my tasks, the countdown, task comments, broadcasts (push notifications with Acknowledge, Snooze and Done), and accepting or declining a role in an event. **Approvers can also review and approve events on mobile** (view tasks, comment, approve). The app includes **log in** and **password reset**. New users are sent to the **web sign-up page** with a link. |
| **Web app (command centre)** | Runs in a desktop browser. No separate Windows or Mac app. | Approvers and Admins | **Web only:** creating and editing events, signing up, and team management (invites, roles, vetting new joiners). The command centre runs from a desktop or laptop connected to a screen by **HDMI** and controls the live flow of the event. |
| **Mobile web (guest view)** | The web app in a phone browser, opened from a link | Unregistered participants, e.g. guest speakers | Guests don't have to download the app. They're told about the event by **email**, and the link opens their program and tasks in the phone browser, where they can acknowledge or decline. Each link is personal and expires after the event. No live broadcasts. |

**Why:** during a live event most people have their phones on them, so the participant experience has to be native on mobile. The command centre needs a big screen and a stable setup, and running it in a browser avoids building separate desktop apps.

**Command centre screen audience:** the HDMI screen is angled so that people on stage and backstage can see it. It is not meant for the audience, though audience members may catch a glimpse of it.

*Design note (proposed):* treat the screen as semi-public. Show the run of show, timings and "up next", and keep private comments and sensitive notes off the big screen.

### 1.2 Tech stack (v1)

| Layer | Choice | Used for |
|---|---|---|
| **Mobile apps** | **Flutter** (iOS and Android) | The participant app on the App Store and Play Store |
| **Web frontend** | **React + Vite** | The command centre, Admin screens (events, team, sign-up), and the guest mobile web view, all in one web app that works on desktop and phone |
| **Web hosting** | Cloudflare Workers (static assets) | Serves the React app |
| **API** | Cloudflare Workers (TypeScript) | One API for the mobile apps and the web app |
| **Database** | Cloudflare D1 | The main data store (section 10) |
| **Live events** | Cloudflare Durable Objects (WebSockets + alarms) | One live "room" per event: current task, auto-progression timers, broadcast delivery, 3-minute snooze re-alerts. Keeps every phone and the command centre in sync. |
| **Background jobs** | Cloudflare Queues | Sending notifications without slowing down the app |
| **Email** | Cloudflare Email Service | Invites, review requests, guest links and approval emails. *Currently in public beta, and needs the Workers paid plan.* |
| **Push notifications** | Firebase Cloud Messaging, called from Workers | Push to both Android and iPhone. Not a Cloudflare service; Cloudflare has no push offering. |
| **Text messages** | Third-party SMS provider *(to choose)* | Team invites by text (QR008). Cloudflare has no SMS service. |
| **Logins** | Built in the Workers API (with an auth library) | Email and password, email verification, password reset and sessions. Cloudflare has no user-login service for customer apps. |
| **File storage** | Cloudflare R2 | Not needed in v1. Ready for later items such as countdown videos. |

## 2. Problem

Running a live event with many people involved, and keeping it free of dead air, is hard:

- An event agenda usually needs input from several people before it is final.
- Agendas often change at short notice, even after they have been finalised.
- Every change has to reach everyone concerned in real time.
- In a multi-stage event, every participant needs to know exactly where they should be.

## 3. Current alternatives

- Paper and pen
- Microsoft Word
- Google Docs and Google Sheets
- Email

## 4. Target users

- Executive assistants who run corporate meetings
- Concert planning teams

**Why they care:** they care about doing the event well. Paying attendees need to have a good time so that they come back next time.

**Guiding question for customers:** *What do you want people to say after they attend your event?*

**Primary persona: the event coordinator.** Qrono is built from the product owner's own experience as an event coordinator, so that role is the reference user for v1 decisions. Detailed persona write-ups are set aside for now.

---

## 5. Glossary

| Term | Definition | Notes |
|---|---|---|
| **Event** | Something with a set start time, end time, tasks and assigned participants. | An event can recur, but each instance must have its own unique ID. |
| **Task** | A time-bound item within an event. | |
| **Agenda** | The approved sequence of tasks in an event: their order, durations and assignees. | |
| **Team** | A group of people who can hold events together, such as a company or a department. | People can join a team only by invitation. |
| **Approve** | To move an event from Review to Approved. | |
| **Task duration** | How long a task is meant to last. | Measured in minutes. |
| **Participant** | A team member responsible for running a task. | A task can have several participants, listed in roll-call order. |
| **Start time / End time** | The date and time the event is scheduled to begin and end. | |
| **Broadcast** | A message sent while an event is live. | Recipients can respond with **Acknowledge**, **Snooze** (re-alerts after 3 minutes) or **Done**. Sent as a push notification. |
| **Day** | An event can be single-day or span several days. | An event that runs past midnight without a break (e.g. 10pm–2am) still counts as single-day. |
| **Stage** | The area where the audience's attention is focused. An event is single-stage or multi-stage. | Stages are named after the hall they are in, with one stage per hall. |
| **Mandate** | The approval rule the organisation uses. | Default: **Any to sign**, meaning any one designated approver can approve. Possible later options: "At least 2 to sign" or a fixed signing order. |

---

## 6. User roles

| Role | Capabilities | Notes |
|---|---|---|
| **Approver** | Everything an Admin can do, plus moving an event from Review to Approved. | There can be several Approvers. Approval follows the team's mandate. |
| **Admin** | Create and edit events, and add new users. | There can be several Admins. |
| **Member** | Basic access. Can be made a participant but cannot create, edit or approve events. | |
| **Participant** | Any user assigned to a task in an event. Can be an Approver, Admin or Member. | One participant can handle several tasks, and one task can have several participants. |
| **Unregistered participant** | Someone assigned to a task who has not yet joined the team. | |

### 6.1 Permissions matrix

| Action | Approver | Admin | Member |
|---|---|---|---|
| Participate in an event | ✅ | ✅ | ✅ |
| View the command centre (live control view) | ✅ | ✅ | ❌ |
| Add a user to the team | ✅ | ✅ | ❌ |
| Approve a user joining via invite link* | ✅ | ✅ | ❌ |
| End an event | ✅ | ✅ | ❌ |
| Comment on a task in a pre-approval event (Draft/Review) | ✅ | ✅ | ✅ only if a participant on that event |
| Comment on a task in a post-approval event | ✅ | ✅ | ✅ only if a participant on that event |
| Send a broadcast in a Live event | ✅ | ✅ | ❌ |
| Create / edit events | ✅ | ✅ | ❌ |
| Approve an event (Review → Approved) | ✅ | ❌ | ❌ |

\*People who join with an invite link must be vetted and approved before they get access. Invite links join users as Members only.

**Decision:** there is no separate "super admin". The Approver role already fills that place: it has every Admin right plus event approval. Qrono keeps three roles: Approver, Admin and Member.

---

## 7. Event lifecycle

| Phase | Status | Description | What happens |
|---|---|---|---|
| Pre-approval | **Draft** | Planning stage: participants are being suggested and the order worked out. Every event starts as a Draft, and only Admins can create one. | |
| Pre-approval | **Review** | The draft has been submitted for approval. | At least one Approver must be chosen. The chosen Approvers are notified. |
| Post-approval | **Approved** | At least one Approver has checked the event and clicked **Approve**. | All Admins and all participants are notified. A countdown to the start time appears. |
| Post-approval | **Live** | The current time is between the event's start and end times. | |
| Post-approval | **Past** | The end time has passed, or an Admin clicked **End Event** in the Live view. | |

```
Draft → Review → Approved → Live → Past
```

---

## 8. Event formats

**Single-stage:** one stage (e.g. Radisson Blu, Adire Hall) with a linear agenda.
> Opening (5m) → Introductions (15m) → Presentation (7m) → Keynote (35m) → Q&A (10m) → Award (7m) → Close (3m)

**Multi-stage, mixed:** shared sessions that split into parallel breakouts on several stages, then come back together.
> Opening → Introductions → Keynote → *[Break-out I + Q&A on Stage 1 ‖ Break-out II + Q&A on Stage 2]* → Conclusions → Close

**Multi-stage, parallel:** separate agendas running side by side on different stages for the whole event.
> Stage 1: Opening → Introductions → Welcome → Plenary → Q&A → Wrap-up → Departure
> Stage 2: Welcome → Guest arrival → Anthem → Session 1 → Lunch → Session 2 → Ending

---

## 9. User stories

### 9.1 Registration & onboarding
| Code | As a… | I want to… | So that… |
|---|---|---|---|
| QR001 | New user | join a team using an invite link | *(Invite links join users as Members only. Role upgrades happen after joining.)* |
| QR002 | New user | create an account | I can be identified uniquely |
| QR003 | New user | verify my email address | spam accounts are prevented |
| QR004 | New user | log in | I can use the platform |
| QR005 | Returning user | reset my password | |
| QR043 | New user on the mobile app | follow a link from the app to the web sign-up page | I can create my account (sign-up is web only) and then log in on the app |
| QR044 | Unregistered participant (e.g. guest speaker) | get an email with a link when I'm added to an approved event | I know my role without signing up |
| QR045 | Unregistered participant | open the event program and my tasks in my phone's browser from that link | I can follow the event without downloading the app |
| QR046 | Unregistered participant | acknowledge or decline my role (with a reason) from my link | the organisers know whether I'm confirmed |

**Guest rules (v1):**
- Each guest gets a **personal link**, and it **expires when the event ends**.
- Guests do **not** receive live broadcasts.
- Guests can acknowledge or decline from their link (QR046).

### 9.2 User & team management
| Code | As a… | I want to… |
|---|---|---|
| QR006 | Admin | create a team |
| QR007 | Admin | invite team members by email |
| QR008 | Admin | invite team members by text message |
| QR009 | Admin | assign roles on my team |
| QR010 | User | belong to several teams at the same time |

### 9.3 Creating events
| Code | As a… | I want to… |
|---|---|---|
| QR019 | Admin | create a draft event |
| QR020 | Admin | edit a draft event |
| QR021 | Admin | pick participants from team members |
| QR022 | Admin | set start and end times for every event |

### 9.4 Approving events
| Code | As a… | I want to… |
|---|---|---|
| QR011 | Approver | get email and in-app notifications when an event is ready for review |
| QR012 | Approver | view all tasks in an event under review |
| QR013 | Approver | view and add comments on each task in an event under review |
| QR014 | Admin | view and add comments on each task in an event under review |
| QR015 | Admin | see the comment history on a task in an event under review |
| QR031 | Member | view and comment on tasks in Draft or Review events I'm assigned to as a participant |
| QR016 | Approver | approve an event that is in review |
| QR017 | Admin | be notified when an event moves from Review to Approved |
| QR018 | Participant | be notified when an approved event includes me |
| QR032 | Participant | get an email when an approved event includes me |
| QR033 | Participant | acknowledge receiving that email |
| QR034 | Participant | decline to take part in the event |
| QR035 | Participant | give a written reason for declining |
| QR036 | Admin | see which participants have acknowledged or declined an event |

### 9.5 Live events
| Code | As a… | I want to… | So that… |
|---|---|---|---|
| QR023 | Participant | see a summary program of all tasks in an event | |
| QR024 | Participant | filter the program to only my tasks | |
| QR025 | Participant | see a countdown to the start of the event | |
| QR026 | Participant | comment on a task | |
| QR027 | Admin | set the event to move on automatically by the agenda | I don't have to switch tasks by hand |
| QR028 | Admin | set the event to move on only when someone does it manually | I can control the flow of the event |
| QR029 | Admin | end an event at any time | |
| QR030 | Admin | see a warning before ending an event | |
| QR037 | Admin | produce a report of the whole event | |

### 9.6 Broadcasts (Live events)
| Code | As a… | I want to… | So that… |
|---|---|---|---|
| QR038 | Admin | send a broadcast to everyone in a Live event | every participant hears about a change at the same moment |
| QR039 | Admin | send a broadcast to selected participants or one stage | I can redirect one group in a multi-stage event without distracting the others |
| QR040 | Participant | get a broadcast as a push notification and an in-app alert during a Live event | I see urgent updates immediately, even when the app is closed |
| QR041 | Participant | respond to a broadcast with Acknowledge, Snooze or Done | the organisers know I've seen it and whether I've acted on it |
| QR042 | Admin | see each participant's response to a broadcast | I can follow up with anyone who hasn't responded |

**Broadcast rules (v1):**
- Broadcasts go out as push notifications, plus an in-app alert.
- **Snooze** brings the broadcast back after **3 minutes**.
- Targeting by participant or stage (QR039) is in scope for v1.

---

## 10. Data model (v1)

*A proposed design that covers every decision in this PRD. Developers can adjust names and types to suit the stack.*

**Conventions**
- Every record has a unique, random, non-sequential ID (e.g. UUID or nanoid). Each instance of a recurring event gets its own ID.
- All timestamps are stored in UTC. Each event stores its own time zone for display.
- Records get `created_at` and `updated_at` unless noted otherwise.

### 10.1 People & teams

**User**: a registered account (sign-up happens on the web only).
| Field | Type | Notes |
|---|---|---|
| `id` | ID | |
| `first_name`, `last_name` | text | |
| `email` | text, unique | Used to log in |
| `email_verified_at` | timestamp, nullable | QR003 |
| `phone` | text, nullable | Needed for text-message invites (QR008) |
| `password_hash` | text | |

**Team**: a company or department.
| Field | Type | Notes |
|---|---|---|
| `id` | ID | |
| `name` | text | Only Approvers and Admins can set it |
| `mandate` | enum: `any_to_sign` | Default and only v1 value. More rules come later. |
| `created_by` | → User | |

**TeamMembership**: a user's role on a team. One user can be on several teams (QR010).
| Field | Type | Notes |
|---|---|---|
| `id` | ID | |
| `team_id` | → Team | |
| `user_id` | → User | Unique together with `team_id` |
| `role` | enum: `approver`, `admin`, `member` | |
| `status` | enum: `pending_vetting`, `active`, `removed` | People who join by invite link start as `pending_vetting` |
| `approved_by` | → User, nullable | The Admin or Approver who vetted them |

**TeamInvite**: an invitation by email, text or shareable link (QR001, QR007, QR008).
| Field | Type | Notes |
|---|---|---|
| `id` | ID | |
| `team_id` | → Team | |
| `channel` | enum: `email`, `sms`, `link` | |
| `recipient` | text, nullable | Email or phone. Empty for a shareable link. |
| `role` | enum | Always `member` for `link` invites |
| `token_hash` | text | Only a hash of the token is stored |
| `expires_at` | timestamp | |
| `status` | enum: `pending`, `accepted`, `revoked`, `expired` | |
| `created_by` | → User | |

**DeviceToken**: where to send push notifications to the mobile app.
| Field | Type | Notes |
|---|---|---|
| `id` | ID | |
| `user_id` | → User | A user can have several devices |
| `platform` | enum: `ios`, `android` | |
| `token` | text | Push token from Apple or Google |
| `last_seen_at` | timestamp | Lets old tokens be cleaned up |

### 10.2 Events & agenda

**Event**: one instance of an event.
| Field | Type | Notes |
|---|---|---|
| `id` | ID | |
| `team_id` | → Team | |
| `series_id` | → EventSeries, nullable | Set for recurring events |
| `name` | text | |
| `description` | text, nullable | |
| `start_at`, `end_at` | timestamp | QR022. An event can cross midnight and still count as single-day. |
| `timezone` | text | e.g. `Africa/Lagos` |
| `status` | enum: `draft`, `review`, `approved`, `live`, `past` | See section 7 |
| `progression_mode` | enum: `auto`, `manual` | QR027 / QR028 |
| `current_task_id` | → Task, nullable | The task that is on now, shown in the command centre |
| `created_by` | → User | |
| `ended_early_by`, `ended_early_at` | → User, timestamp, nullable | An Admin pressed **End Event** (QR029) |

**EventSeries**: the rule behind a recurring event.
| Field | Type | Notes |
|---|---|---|
| `id` | ID | |
| `team_id` | → Team | |
| `recurrence_rule` | text | e.g. an iCal RRULE such as "every Sunday" |

**Stage**: a hall or stage within an event.
| Field | Type | Notes |
|---|---|---|
| `id` | ID | |
| `event_id` | → Event | |
| `name` | text | Usually the hall name, e.g. "Adire Hall" |
| `venue` | text, nullable | e.g. "Radisson Blu" |
| `sort_order` | int | |

**Task**: one timed item in the agenda.
| Field | Type | Notes |
|---|---|---|
| `id` | ID | |
| `event_id` | → Event | |
| `stage_id` | → Stage, nullable | Empty means the task runs on all stages (e.g. a joint opening before breakouts) |
| `title` | text | |
| `description` | text, nullable | |
| `sort_order` | int | Order within its stage |
| `planned_start_at` | timestamp | |
| `duration_minutes` | int | |
| `status` | enum: `upcoming`, `in_progress`, `done`, `skipped` | |
| `actual_start_at`, `actual_end_at` | timestamp, nullable | Recorded live. Used for overrun warnings and the event report (QR037). |

The three event formats in section 8 all fit this model. A single-stage event has one Stage. A mixed event has some tasks with no stage (shared by all) and some tied to a stage (breakouts). A parallel event gives each stage its own sequence of tasks.

### 10.3 Participants & guests

**EventParticipant**: anyone assigned to work in an event, either a team member or a guest.
| Field | Type | Notes |
|---|---|---|
| `id` | ID | |
| `event_id` | → Event | |
| `user_id` | → User, nullable | Set for registered team members |
| `guest_name`, `guest_email` | text, nullable | Set for guests (unregistered participants) |
| `response` | enum: `pending`, `acknowledged`, `declined` | QR033–QR036, QR046 |
| `decline_reason` | text, nullable | QR035 |
| `notified_at`, `responded_at` | timestamp, nullable | |

Each row has exactly one of `user_id` or the guest fields set. If a guest later signs up, the row can be linked to their new User.

**TaskAssignment**: who is responsible for each task.
| Field | Type | Notes |
|---|---|---|
| `task_id` | → Task | |
| `participant_id` | → EventParticipant | |
| `roll_call_order` | int | Order when a task has several participants |

**GuestAccessLink**: the guest's personal link to the mobile web view.
| Field | Type | Notes |
|---|---|---|
| `id` | ID | |
| `participant_id` | → EventParticipant | One active link per guest |
| `token_hash` | text | Only a hash of the token is stored |
| `expires_at` | timestamp | Set to the event's `end_at`, or earlier if the event is ended early |
| `revoked_at` | timestamp, nullable | Lets an Admin cancel the link |
| `last_opened_at` | timestamp, nullable | |

### 10.4 Review & approval

**EventApprover**: the Approvers chosen when an event is sent for review.
| Field | Type | Notes |
|---|---|---|
| `event_id` | → Event | |
| `user_id` | → User | Must have the Approver role on the team |
| `approved_at` | timestamp, nullable | With **any to sign**, the first approval moves the event to Approved. Keeping one row per Approver lets stricter rules be added later. |

**EventStatusChange**: a log of every status change, for history and the event report.
| Field | Type | Notes |
|---|---|---|
| `event_id` | → Event | |
| `from_status`, `to_status` | enum | |
| `changed_by` | → User, nullable | Empty when the system changes it (e.g. going Live at the start time) |
| `changed_at` | timestamp | |

### 10.5 Comments

**Comment**: a comment on a task, at any stage of the event.
| Field | Type | Notes |
|---|---|---|
| `id` | ID | |
| `task_id` | → Task | |
| `author_id` | → User | Only registered users. Guests don't comment in v1. |
| `body` | text | |
| `event_status_at_post` | enum | Records whether it was posted before or after approval |
| `edited_at`, `deleted_at` | timestamp, nullable | Comments are never hard-deleted, so the history stays complete (QR015) |

Comments are private. They show in the app and the web app, but never on the HDMI command-centre screen.

### 10.6 Broadcasts

**Broadcast**: a message sent during a Live event.
| Field | Type | Notes |
|---|---|---|
| `id` | ID | |
| `event_id` | → Event | Only allowed while the event is `live` |
| `sent_by` | → User | Approver or Admin |
| `body` | text | |
| `audience` | enum: `everyone`, `stages`, `participants` | QR038 / QR039 |
| `sent_at` | timestamp | |

**BroadcastTarget**: who a targeted broadcast goes to (used only when `audience` isn't `everyone`).
| Field | Type | Notes |
|---|---|---|
| `broadcast_id` | → Broadcast | |
| `stage_id` | → Stage, nullable | Everyone assigned to tasks on this stage |
| `participant_id` | → EventParticipant, nullable | One person |

**BroadcastReceipt**: one row per person who receives the broadcast.
| Field | Type | Notes |
|---|---|---|
| `broadcast_id` | → Broadcast | |
| `user_id` | → User | Registered users only, since guests don't get broadcasts |
| `delivered_at` | timestamp, nullable | |
| `response` | enum: `none`, `acknowledged`, `snoozed`, `done` | QR041 |
| `responded_at` | timestamp, nullable | |
| `snooze_until` | timestamp, nullable | The response time plus 3 minutes, when the alert comes back |
| `snooze_count` | int | |

The Admin's view of replies (QR042) comes from these receipts.

### 10.7 Notifications

**Notification**: every message sent to a person, on any channel.
| Field | Type | Notes |
|---|---|---|
| `id` | ID | |
| `user_id` | → User, nullable | |
| `participant_id` | → EventParticipant, nullable | For guests, who have no user account |
| `type` | enum | e.g. `review_requested`, `event_approved`, `assigned_to_event`, `broadcast`, `team_invite` |
| `channel` | enum: `push`, `email`, `sms`, `in_app` | |
| `related_event_id` | → Event, nullable | |
| `sent_at`, `read_at` | timestamp, nullable | |
| `status` | enum: `queued`, `sent`, `failed` | |

### 10.8 How the records connect

```
Team ─┬─< TeamMembership >── User ──< DeviceToken
      ├─< TeamInvite
      ├─< EventSeries ──< Event
      └─< Event ─┬─< Stage ──< Task (stage optional)
                 ├─< Task ──< TaskAssignment >── EventParticipant
                 ├─< EventParticipant ──< GuestAccessLink (guests only)
                 ├─< EventApprover >── User
                 ├─< EventStatusChange
                 ├─< Broadcast ─┬─< BroadcastTarget
                 │              └─< BroadcastReceipt >── User
                 └─ Task ──< Comment >── User
```
`─<` means "has many".

---

## 11. Open questions & gaps

1. ~~**Admin split**~~: *Resolved.* There is no super admin; the Approver fills that role (see 6.1).
2. ~~**Permissions matrix**~~: *Resolved* (see 6.1).
3. ~~**Personas**~~: *Set aside.* The primary persona is the event coordinator, based on the product owner's own experience (see 4).
4. ~~**Story codes**~~: *Resolved* (QR032–QR037).
5. ~~**One-time upgrade price**~~: *Removed.* Pricing is deferred.
6. ~~**Pricing tiers**~~: *Removed.* Pricing will be set later from real usage.
7. ~~**Broadcasts**~~: *Resolved.* Stories QR038–QR042; Snooze lasts 3 minutes; broadcasts are sent by push; QR039 is in v1.
8. ~~**Unregistered participants**~~: *Resolved.* Notified by email, with access through a personal link to the mobile web view that expires after the event. They can acknowledge or decline there but get no broadcasts (QR044–QR046).
9. ~~**Ideas not yet specified**~~: *Moved to Later* (see section 12).
10. ~~**Platform split**~~: *Resolved.* Creating and editing events, signing up and team management are web only. Approving events works on both web and mobile (see 1.1).
11. ~~**Command centre screen**~~: *Resolved.* It is for people on stage and backstage, not the audience, though the audience may glimpse it (see 1.1).
12. **SMS provider:** which provider sends invite text messages? It needs good delivery in Nigeria (e.g. Termii or Twilio).
13. **Email in beta:** Cloudflare Email Service is in public beta. Is that acceptable for launch, or should a second email provider be ready as a fallback?

---

## 12. Later (not in v1)

- Screen-only event mode
- Custom countdown video for an event
- Exclusive early access programme
- Pricing, to be set from real usage after launch
- More complex approval mandates (e.g. "At least 2 to sign", signing order)

---

## Appendix A — Reference events studied

| Type | Organisation | Tasks |
|---|---|---|
| Exhibition / Virtual | Intermac Consulting (Digital Pay Expo) | 18 (18 participants) |
| Conference | Nigerian Bar Association | 30 |
| Conference | Nigerian Institute of Chartered Arbitrators | 28 |
| Conference | NACADA | 36 |
| AGM | Telkom | 8 |
| Conference | WISCAR, Datafest Africa, JCI, ASA, Nigeria Innovation Summit, NABCA, TEDxOAU | — |
| Virtual conference | Wiley | — |

## Appendix B — Brand inspiration

- "Teach us to live well! Teach us to live wisely and well!" (Psalm 90:12, MSG)
- "There's an opportune time to do things, a right time for everything on the earth" (Ecclesiastes 3:1, MSG)
