## What is MereMail?
MereMail is a self-hosted webmail API + client. It connects to any IMAP and SMTP server, syncs your mail into an SQLite database, and serves a modern web interface on top. Search is fast because it's actual full-text search instead of IMAP SEARCH. Threading is computed once when it gets incoming emails, instead of being reconstructed on every view. The API isn't stuck in 1986.

MereMail is **not**:
- A mail server - you have to figure that part out, MereMail just gives you a way to access and organize.
- A replacement to Gmail - it has no ML features (unless you build it yourself), nothing about it is particularly "smart," and it relies on your own ability to host it.
- Trying to reinvent your relationship to email a la services like Hey.

It's just mail, stored in a database so it can be searched and accessed easily. Or merely mail, whichever you prefer. Back up the DB, query it directly, export it to other standards, whatever you like.

## Why build MereMail?
Because I was dissatisfied with basically all existing alternatives.

**The big providers work really well, but you don't own anything.** Gmail has enough users to represent a good chunk of the world population. The search is fast, the spam filtering is excellent, the mobile apps are really good. And yeah, it's free of charge. But the cost is that now every email you've sent or received is subject to Google's policies, and they only stopped reading email contents to target ads in 2017. That's actually fine for most people, but not me.

Now, other providers try to solve the privacy problem - Fastmail and Proton are better with it, but you're still renting. Your mail lives on their servers, you use their apps, and you're at their mercy if you want to switch. Proton's encryption is real, but the tradeoff is that IMAP and SMTP aren't designed to access emails stored using zero-access encryption — you need their proprietary Bridge app to use any standard client. Users on the free plan have no IMAP access at all. So yeah, you're still locked in, just with a better warden.

**The self-hosted options are frozen in time.** *Roundcube* has been around since 2008. It works really well for what it was designed for and it's more stable than the vast majority of projects from that era. It's just that the reason for that is that it *still looks and feels like a mail client from 2008*. Also, it's an IMAP client in a browser — every operation goes back to the server. If you have a big mailbox, search is a nightmare because you're using a protocol - and probably even an implementation - which was designed for a time when emails were tiny pieces of text being sent around the same 1,000 or so people. *SnappyMail* is faster and cleaner, but it hits the same wall: it's constrained by IMAP itself.

The fundamental problem is architectural. Webmail clients don't actually store mail, so searches can only be performed on the IMAP server. Threading has to be reconstructed on each view, because IMAP doesn't actually support that. Every action requires a round-trip. The client can only be as good as IMAP allows, and IMAP was designed when "webmail" wasn't even a concept.

**The good clients have their own backends.** Why is Gmail's search so fast and Outlook Online's search functional? Because they don't actually use IMAP internally. They expose it for *compatibility* with mail clients that use it but internally they've got their own backend. It's the same with Fastmail (who built JMAP as the modern replacement then went on to be the only one who built a proper client for it). Same with *Hey*. They use their own backends, which expose their own APIs, that their own clients use. Suddenly email is this vertically integrated platform and these companies own every slice.

Now, *Nylas* proved this could be open source. Their sync engine pulled from IMAP, stored in MySQL, and exposed a clean REST API. The N1 email client sat on top. It was exactly the right architecture. Then Nylas pivoted to enterprise, killed the open source version, and the repo rotted. Nobody's picked up that torch because - let's be real - this is a problem for such a tiny set of people. I just happen to be one of those people.

Thus, MereMail is an attempt to build what should exist: a self-hosted mail API and client that stores your mail in a real database, indexes it properly, exposes a modern API, and doesn't pretend IMAP is adequate for 2025.

## Why use MereMail?
Let me be the one to say: most people probably shouldn't. If you're happy with Gmail, stay with Gmail. The privacy cost is real, but so is the polish. Google has thousands of engineers making email work well, the Google way. MereMail has me and anybody who dares raise a PR.

If you want privacy without complexity, then pay for Fastmail or Proton. They're cheap - Proton even has a free tier, the search is good, the apps are solid, and yeah - the encryption is real.

If Thunderbird does what you need, use Thunderbird. It's mature, handles multiple accounts well, has proper offline support. MereMail doesn't replace it — they serve different use cases.

MereMail is for a specific kind of person:

- You already run a mail server, or use a cheap IMAP provider (shout out [Purelymail](http://www.purelymail.com)!), and you want a web interface that doesn't feel like 2005
- You want your mail in a format you control — a file you can back up, query, and take with you
- You're frustrated that searching your own email is slower than searching the entire web
- You want an API for your own mail that doesn't require IMAP libraries
- You're comfortable self-hosting

That's basically just me and people who are equally insane. But MereMail isn't a startup trying to capture market share. It's a tool for people who want to own their email the way they own their files — self-hosted, backed up simply, accessible without permission from a service provider. If that's you, let me introduce MereMail. If it isn't, well, you're in good company.
