// Výňatek skutečného textu x.ai/changelog/bot z Exa (stažen 25. 10. 2026 přes Exa MCP,
// ne přes REST /contents): vydání 0.75.5 až 29. 9. a 17.–15. 9. 2026 (s položkou „Enterprise“).
// Obsahuje bloky bez čísla verze a oddíly bez nadpisu ### tak, jak je Exa vrací.
export const GROK_BOT_EXA_TEXT = `# Grok Bot Changelog | SpaceXSI
URL: https://x.ai/changelog/bot

Grok Bot Changelog | SpaceXSI

# Changelog

New features, improvements, and fixes in each release.

Grok Build Grok Bot

Latest v0.75.5· Oct 23, 2026· RSS

October 23, 2026 Oct 23, 2026

v0.75.5

## Vault, email forwarding, and fewer approval cards

Also includes 0.75.3 and 0.75.4

### New

- Bots can save your logins, cards, and contact info to a Vault in Settings and fill them in to sign in or check out. Requires Grok Bot 0.75.2 or later.
- Bots can forward an email from their own inbox with its original formatting, images, and attachments. Requires Grok Bot 0.75.2 or later.
- Bots record who asked for each message they post in Slack, so anyone in the thread can ask who requested it.
- For Halloween, you can give a Bot a pumpkin shape when you create it or change its avatar. Requires Grok Bot 0.75.2 or later.

### Improved

- Auto-review asks less often for an action you asked for in your own words.
- After you deny an approval card, the Bot stops and doesn't try that action again until you send another message.
- Emails and Slack messages you ask a Bot to send go out once Auto-review allows them, while sends on routine and other turns still wait as drafts.
- When the Bot hands you its computer to sign in to a site that has a connector, it also offers that connector's connect card.
- Asking a Bot about your X account connects X through your linked X account, even if you removed the X plugin.
- Connecting X also connects X Money through the same account, and asking about your X Money balance, activity, or card installs X Money.
- Your routines can run up to 300 times an hour in total instead of 100, and each routine up to 200 times.
- With Route traffic through this computer on, Settings shows how many sites were blocked because they resolve to a private or VPN address.
- Teammates in their own DM with a Team Bot can react to messages, quote with Add to chat, and answer cards. Teams
- Team Bots name connectors as your plugin list does, such as Google Slides, when they ask to use one or say whose they used. Teams
- If your Grok Business seat doesn't cover Grok Bot yet, the usage limit message says to ask your Grok Business admin to connect your team.

### Fixed

- Auto-review falls back to an approval card less often, retrying a check that fails and reviewing long chats instead of stopping.
- Auto-review no longer waves through an action your request said to stop before, such as sending a message you asked only to draft.
- Asking a Bot about your X followers gets a plain answer that X doesn't offer it, instead of a browser sign-in to X.
- After an account merge, you keep managing the Bots you created and can share them with your team.
- Plugins with several servers, such as Salesforce, show each server as its own row, so you can see and sign in to every one.
- In Slack, Bots answer thread replies that were also sent to the channel, as they do other thread replies.
- On a Team Bot's Share this Bot card, someone who manages the Bot through a group sees their role as Manager. Teams
- Work a Team Bot hands off in a shared chat can use the connectors you allowed, and its reply says whose connector it used. Teams
- When a Team Bot's routine replies in a Slack thread, the Bot follows the thread and answers later replies without an @mention. Teams
- After you reset a chat whose first message was blocked, new messages get replies instead of an error.

October 22, 2026 Oct 22, 2026

v0.75.2

## Pages, new chat cards, and video creation

Also includes 0.72.0, 0.72.1, 0.73.0, 0.73.1, 0.74.0, 0.75.0 and 0.75.1

### New

- Bots can build Pages, such as reports, memos, and dashboards, that you edit together or have the Bot keep up to date.
- Bots can create videos from a description or from an image you share.
- You can pin Library pages, files, and links to a Pinned section that stays at the top and syncs across your devices.
- The dashboard's Pages section lists the Pages you've shared, where you can unshare or delete them.
- Hovering over or focusing a Library row shows a preview with who sent the item, when, and who can see a Page.
- Bots can pay with Shop Pay, through Shop checkout where a store accepts it and with a one-time Shop card elsewhere.
- You can connect X Money in one tap from a chat, the connector page, or checkout, after signing in to X if no X account is linked.
- Page owners can share a Page with their whole organization or with another team in it. Teams
- Team admins can limit who can share Pages with everyone on the team. Teams
- Team admins can turn on link previews that show a Team Bot's name, description, color, and shape wherever its link is posted. Teams
- A keyboard shortcuts sheet opens with ⌘/ and from Help, the profile menu, and the command palette.
- Typing \`>\` at the start of a composer line starts a block quote, and Backspace at the start of a quoted line lifts it back out.
- You can reorder attachments in the composer by dragging them or by pressing Alt with the arrow keys.
- You can connect Zoho CRM and choose your account's regional data center before you sign in.
- Team admins can upload a team icon, shown in workspace selectors and on Team Bots. Teams
- Team Bot owners and managers can let collaborators create routines from Configure. Teams
- Pages can capture the pointer and fill the screen.
- The GitHub connector can list your repositories, compare commits, list a pull request's commits, and read branch and issue comments.
- The built-in Gmail connection can attach files to drafts and sends, reply all, add a note when forwarding, and set label colors.
- Bots can create, update, or delete several Google Calendar events in one step, and edited events no longer shift to a different time.
- Routines can read the Bot's inboxes.
- A task the Bot hands off can create images and videos for the chat.
- A shared Team Bot's welcome in a team or group chat includes a Chat with me link, and an owner-only Bot greets only its owner. Teams
- Enterprise team admins can permanently delete a member's Grok Bot data from Manage Member Computers and Data in Security & Compliance, or through the Admin API. Enterprise

### Improved

- Cards in chat have a new design, from approvals and questions to files, links, and tables.
- The Bot details pane is one column, with a profile you click to edit above Media, Computer, and Routines tabs.
- Voice calls can draw on your earlier calls and recent chat with the Bot.
- The Bot opens links before sending them and leaves out broken ones.
- Auto-review approval cards describe the action in one sentence, name the app with its logo, and flag irreversible or sensitive changes.
- When you name a service, the Bot shows that connector's connect card in its first reply.
- When a connector signs you out or rejects a sign-in, the Bot says why, such as a restricted Google account, and how to fix it.
- When a routine hits a signed-out connector, the chat shows that connector's Reconnect card, at most once a day.
- Before a browser or desktop task that takes a few minutes, the Bot tells you it will take a while.
- If you already shared a password or code in the chat, the Bot uses it instead of refusing to continue.
- Pull requests, issues, and repositories mentioned in replies are links.
- When the Bot asks how to pay, you choose on a card.
- What a personal Bot saves to memory in one chat is remembered in all your chats with it, and only you can change it.
- Deleting a Bot permanently erases its conversations, memory, routines, and attachments, and removes its Slack app.
- The first email a Bot sends to someone new includes a one-click unsubscribe link.
- In Slack, asking the Bot to investigate, research, or check something gets a researched answer instead of a quick reply.
- Deleting your account first lists what you'd lose, and linking an already unified Grok account offers to merge into it instead of failing.
- Source links in replies show as compact citation chips, and company names as ticker pills.
- Number columns in chat tables line up on the decimal point, with header sublines, summary rows, and footnotes.
- Files you send show as cards with their type, name, and size, and captioned images offer Copy and Download on hover.
- Your reactions show the moment you tap them, and the message no longer shifts under your pointer.
- The Library opens faster for people with many Team Bots.
- Team Bots shared with you open straight to their saved conversation. Teams
- Browser sign-in waits up to 20 minutes and offers Copy link, and Reopen link resumes the same sign-in instead of starting over.
- Connect Apps shows each plugin's own logo, and setting up a plugin with your own OAuth client lists the callback URLs to register.
- A webhook routine's menu shows its URL and key, and the key stays hidden until you reveal it.

### Fixed

- Scrolling back quickly through a long chat no longer stalls before older messages load.
- Search results from further back in a chat open on the right message, even right after launch.
- Desktop notifications show Bot replies as plain text with full links, and skip replies you already read on another device.
- Voice calls survive network drops and crashes, pick your microphone back up when it reconnects, and the Bot can answer while you're muted.
- Pressing Enter once while recording a voice note sends it.
- Keyboard shortcuts, including ⌘F and the command palette, work while a Page is open, and the palette no longer closes the Page.
- Pressing Back while a Page is open closes the Page and stays on its Bot, instead of jumping to the Bot you viewed before.
- A Page's Share menu shows its current visibility, even after it changed on another device or the dashboard.
- When a message can't be saved, the app says whether your computer is out of disk space.
- The desktop app connects directly unless you've turned on a system proxy, which fixes loading behind some corporate proxies.
- When sign-in can't connect, the app asks you to check your connection instead of saying it stopped waiting for your browser.
- A new or reinstalled desktop app skips onboarding for an account that already finished it.
- Typing a follow-up leaves an open question card unanswered instead of answering it.
- Bot names mentioned with @ in a reply open that Bot's chat.
- Turning a Bot's tool on or off applies the state you saw, so an outdated list can't turn a blocked tool back on.
- When creating a Bot or publishing a Bot template is refused, the app shows the reason.
- Page cards and titles update as soon as the Bot renames a Page, and older Page cards open its latest version.
- Connect Apps waits longer for your plugins instead of showing Couldn't refresh, and built-in plugins no longer offer an Uninstall that failed.
- Buying credits, turning on auto top-up, and saving a spend limit show a confirmation or an error in the desktop app.
- Reactions and card answers you add while a Bot is working stay after its turn ends.
- An approval you don't answer in time leaves a chat line that names what expired.
- Large Google Slides edits update the live deck.
- Emails a Bot sends through Gmail show your name and the signature saved for that address, and reply drafts stay in their thread.
- Bot pictures larger than about 3 MB now save.
- A routine's result still reaches you if you send a message before the Bot finishes handing it off.
- Pausing and resuming a routine keeps your last choice, even when you tap from two devices.
- After an account merge, the remaining account keeps its Grok Bot email inbox and connector settings.

October 14, 2026 Oct 14, 2026

v0.71.2

## Smarter notifications and larger file attachments

Also includes 0.71.0 and 0.71.1

### New

- Bots can send from a tagged form of their email address, like name+shop@, and a routine on that tag runs only for its mail.
- Forms a Bot asks you to fill in can arrive with known fields filled in, and you can edit them before you submit.
- While a paid account merge is still moving this account's data, Settings shows Your accounts are being merged, with Contact Support if it runs long.
- Team admins can turn off Messaging between Bots under Bot capabilities on the dashboard, so members' Bots can't message or hand work to other Bots. Teams
- Enterprise team admins can recreate, terminate, or delete members' Grok Bot computers from Manage Bot Computers on the dashboard or through the Admin API. Enterprise
- When a Bot's computer runs low on disk, the Bot tells you once, names the biggest files, and deletes them only if you agree.

### Improved

- While you use Grok Bot on a Mac or Windows PC, Bot replies and questions notify you there instead of your phone. Requires Grok Bot 0.70.2 or later.
- You can attach files up to 250 MB and videos up to 1 GB, and the Bot says when a video is too large to watch. Requires Grok Bot 0.70.2 or later.
- One message can carry up to 20 attachments instead of 6, and a notice says how many weren't added past the 200 MB total.
- Images a Bot creates or captures, and files from cloud agents it started, load in the chat while its computer is asleep.
- If a voice chat's connection drops, the call reconnects and continues the same conversation instead of ending.
- Bots can use up to 200 skills from your installed plugins instead of 24, so skills from plugins you add are no longer left out.
- When a Bot's computer is asleep, clicking the Computer is asleep preview wakes it in place, replacing the separate Wake button.
- Grok Bot opens while the Bot's computer is still starting, instead of waiting behind a full-window Setting up Grok Bot's computer screen.
- Sending while the Bot's computer wakes no longer shows Waiting to send… under your message or Waking your computer… in the message box.
- Bots can archive, move, delete, flag, or mark many Outlook messages as read or unread in one step instead of one at a time.
- At checkout, Bots use card details or photos you send in chat, asking only for missing fields or a verification code in a Secure Form.
- When GitHub can't see a repository, the Bot stops retrying and gives you a link to the GitHub page where you grant access.
- Bot searches on X with date limits, minimum likes or reposts, or filters X doesn't support now return posts instead of being rejected.
- When a Bot asks you to choose with a question card, it no longer repeats the question and options in a message beside it.
- Email drafts from a Bot's own address show attachments as file cards, marked when they can't be sent, changed since attached, are too large, or weren't scanned.
- Merging accounts finishes when both accounts have files on the Bot's computer, keeping both sets and adding (from transferred account) to clashing file names.
- In Team Bot Slack setup, Connect goes straight to Slack, Awaiting admin approval offers Resubmit, and a denied request shows when it was denied. Teams
- When a Team Bot asks to use your connected account, the card explains the access covers only your own messages and others can't use it. Teams
- Captions in the full-screen image viewer show formatting and clickable links, and images keep their size as you page between them.
- In a Bot's info pane, the name reads as plain text until you hover or click to rename it, and screen readers announce it as editable.
- On approval cards, the rule under labels such as Paused by your Ask first rule shows as plain text, without a box or quotation marks.
- Animated Bot avatars in the sidebar and a chat's activity line move more smoothly.
- When GitHub isn't connected, the Bot offers a single Connect GitHub action instead of listing every GitHub tool.
- A voice call from your phone wakes the Bot's sleeping computer, so the Bot can work with what you said after the call.

### Fixed

- While the Bot's computer is asleep, Grok Bot keeps what it loaded and says Your computer is asleep instead of showing Couldn't refresh or connection errors.
- When the Bot's computer updates, a working Bot reconnects to the new computer and keeps going.
- When the Bot's computer fails to wake, the Bot says it couldn't start instead of retrying as if it were still starting up.
- Images and files a Bot shares from its computer still load in the chat when the app can't fetch them from that computer directly.
- Opening a file right after you send it shows its contents instead of File unavailable.
- When the server fails an attachment upload, Grok Bot says Couldn't upload an attachment and keeps your draft, instead of asking you to check your connection.
- When your computer sleeps, Bots treat it as disconnected within two minutes and say so right away, instead of waiting for commands to time out.
- After a Wi-Fi, VPN, or other network change, Bots can run tasks on your computer right away instead of finding it unreachable.
- Commands a Bot runs on your computer keep going through brief connection stalls and long waits instead of failing as temporarily unreachable.
- If work is meant for one of your computers that's offline, the Bot tells you instead of running it on another computer without asking.
- Background jobs a Bot starts on your Mac, such as a local server, keep running after the command returns.
- Plugin and Auto-review settings changes keep reaching the Bot's computer after Grok Bot reconnects, instead of stalling until a restart.
- When a Bot asks to wait on a command longer than the time limit, it's told the limit right away instead of timing out.
- When a safety check blocks a Bot's reply, the chat shows Blocked by a safety check and Try a different message instead of a generic error.
- Tables in Bot replies stay within the reply's width and scroll sideways when they need more room.
- Attachments in one message that share a file name are numbered, such as report.pdf (2), so you can open or remove the right one.
- On Windows, pasting text copied from a list into the message box keeps it inline instead of splitting it into extra paragraphs.
- On Windows and Linux, text copied from a chat pastes into other apps with non-English characters and curly quotes intact.
- Opening Grok Bot to a restored chat no longer flashes a Couldn't refresh bar above the message box.
- Switching accounts or signing back in shows the app's loading frame instead of a blank white window.
- Switching accounts while a queued message is canceled or refused no longer puts its text and attachments in the other account's message box.
- Accounts without Grok Bot access finish setup and see just the access notice, without setup or load errors.
- When the Bot you had open is deleted on another device, Grok Bot opens another of your Bots instead of an empty pane.
- Deleting several Bots at once still deletes the rest when one fails, and the alert names only the Bot that failed.
- Sidebar section changes that can't be saved stay put with Can't reach your computer and Retry, then save once your computer is reachable.
- In the collapsed sidebar, a Bot list that can't load shows a warning icon with retry instead of text squeezed letter by letter.
- The full-screen computer view no longer shows a cut-off snippet of a subagent's instructions or a Couldn't load subagents line.
- When a Bot's routines fail to load, Couldn't load routines appears inside the Routines section of its details pane.
- With the details pane open and no Bot selected, a failed primary Bot load shows Couldn't load and Try again.
- When a Bot's skills can't be loaded, the @ menu no longer shows a Couldn't load skills row.
- The sidebar's number shortcut badges no longer stay on screen after you change zoom with Cmd or Ctrl.
- In the collapsed sidebar, the More unreads button is a circle with its arrow centered.
- When you drag Bots or sections in the sidebar, screen readers announce their names and where they land.
- Screen readers announce a Bot's reply even when it arrives after the announcement that the Bot stopped.
- When you Tab to a link and its preview card opens, keyboard focus moves into the card.
- When a Bot changes a routine while the app is briefly disconnected, the Routines list updates once it reconnects, without a reload.
- After onboarding creates your primary Bot, the Introducing your primary Bot chooser no longer asks you to pick one again.
- After you answer a request to use your computer, the Bot's sidebar row shows Allowed, Denied, or Expired instead of Permission required.
- When you pause and keep talking in a voice chat, the transcript extends your line instead of repeating it, and leaves out noise tags.
- Connector calls no longer time out after one minute: they wait up to two minutes for a reply, and longer while the connector reports progress.
- Bots see the full parameters of tools on connectors from Grok, so they call those tools correctly instead of guessing.
- Bots hit X's rate limit less often when searching X or reading posts, and a rate-limited call no longer counts toward your X read limit.
- Bots work with a specific Stripe customer, invoice, subscription, or payment on the first try instead of hitting a missing parameter error.
- Stop also ends a Bot's background subagents, so their results no longer wake the Bot afterward, and their pending approval cards expire.
- When you hand the Bot's computer back with I'm done or Skip, the Bot posts its answer in the chat instead of sometimes staying silent.
- Scripts a Bot runs in its browser no longer fail over extra or out-of-range settings, so browser tasks finish more often.
- Secure Form fills fields on more websites, including inside embedded frames from other sites, instead of leaving them empty.
- When a routine needs to sign in to a site, it asks you in chat at that step instead of quietly stopping.
- Bots ask for logins and other multi-field details on one Secure Form instead of a secret request card that holds a single value.
- Screenshot, computer, and browser actions keep working when you haven't connected 1Password, instead of failing on a saved-login check.
- Messaging from another time zone updates the zone the Bot uses for schedules and reminders right away, unless you chose one under Timezone in Settings.
- Bots with any shape the avatar editor offers, such as sparkle or star, can be shared as templates without the Bot changing its look.
- Emails that arrive in a Bot's own inbox keep each link's web address, so the Bot can open verification and sign-in links.
- Email sent to a Bot's own address arrives even when its subject, sender address, or thread references are very long.
- After you choose Disable drafts for a Bot, it sends email from its own address right away, without a draft card.
- After a Bot claims an email address, opening Email or Plugins shows it as Connected instead of still offering Connect.
- When you allow a Team Bot to use one of your plugins, its tools work right away instead of the Bot failing to find them. Teams
- Plugins on a Team Bot use the settings your team admin entered, such as a Datadog site, when the Bot has none of its own. Teams
- A Team Bot still named New team bot with no description shows Draft, not Published to your team, until you rename it or add a description. Teams
- Grok Bot works under your selected team even when another team you're on uses Privacy Mode (Legacy), as long as the selected team doesn't.
- Account merges that move many Bots finish in one go instead of failing and showing Your account merge is taking longer than usual.
- When a downloaded update is withdrawn, Restart to Update goes away and Grok Bot keeps your current version, even when you quit on a Mac.
- An update download that keeps restarting from the beginning waits between tries and then stops with an error instead of retrying nonstop.
- When the update server sends a broken response, Settings says The update server returned an invalid response instead of blaming your connection.
- Restart to Update shows Restarting… and waits up to two minutes for commands a Bot is running on your computer to finish.
- When an update replaces Grok Bot's files while it runs, reloading or crash recovery relaunches the app instead of showing a blank window.
- On Linux deb and rpm installs, Update required links the latest package, leading with it when the package repository doesn't have the update yet.
- On Windows and Linux, opening Grok Bot while it's still quitting reopens it after the quit instead of leaving nothing open.
- GitHub tools stay available after a connection block and work once you reconnect, without starting a new chat.
- When Gmail refuses to open a full thread, the Bot still answers from the thread's first message.
- A connector that still needs Allow keeps its name, so the Bot asks you to allow it instead of saying it can't find it.
- A Bot keeps its connector tools while its computer is asleep, starting up, or not created yet, instead of losing them for that turn.

October 11, 2026 Oct 11, 2026

v0.70.2

## Bot email addresses, X search, and in-chat apps

Also includes 0.69.0, 0.69.1, 0.70.0 and 0.70.1

### New

- Bots can claim their own email address and receive mail there, and email they send from it waits for your approval on a draft card.
- Bots can search X and read posts and profiles without you connecting an X account.
- Connectors that come with an app, such as Figma, Notion, and Canva, can show it as an interactive card in the chat.
- Bots can pay with X Money or Stripe Link.
- Bots can find a Bot template that fits what you describe and link it in the chat.
- On Mac, View Unread in the View menu shows only Bots with unread messages in the sidebar.
- Press Cmd+F or Ctrl+F on an open page to search it in a Find in page bar.
- You can rename a page from its title, and the new name shows everywhere.
- Shared pages have a title bar with Download, which saves a PDF, plus Try Grok Bot for visitors and Share for the owner.
- Adding Glean asks for your Glean MCP URL and connects it after you sign in to Glean in your browser.
- QuickBooks Online is available to connect.
- Bots can save a web page as a PDF from their browser and send audio files such as MP3, M4A, and WAV.
- The full-screen video player has a speed menu, and voice calls offer 0.5x speed.
- Teammates can approve Auto-review requests, including Always allow, from their own direct message with a Team Bot. Teams

### Improved

- Before an action it can't undo, such as sending, posting, buying, or deleting, a Bot checks your own messages for approval.
- Browser approval cards describe actions in plain words, such as Open a new tab in Grok Bot's browser, and a saved Allow rule applies the same way on every tool.
- When more than one account could send an email, the Bot asks which address to use, then tells you the address it sent from.
- When a sign-in emails a code or link, the Bot reads it from your connected Gmail or Outlook, or its own inbox, instead of asking you.
- After a bank or brokerage connector returns data, the Bot asks before sharing it anywhere else.
- Bots acknowledge your message before they start longer work.
- Reactions sit on the message bubble, the quick row includes your recent emoji, and each person shows only their latest reaction.
- Reply quotes show the quoted text and jump to the replied message when clicked, and selecting text shows an Add to chat pill.
- While a Bot works with nothing to report, a 1:1 chat shows just its animated avatar.
- While attachments upload, your message shows a Sending… bar that fills as the files upload.
- The full-screen computer view opens in Watching until you press Take control.
- When a Bot's computer is asleep, the Computer tab shows a Wake button that wakes it in place.
- Computer settings separate Your computer from the Bot's computer, and Updates shows only app updates.
- Updates to Grok Bot's computer run without status pills in the sidebar; you see a notice only if one leaves the computer unreachable.
- After saving a routine, the Bot sums up what it does and who receives the result, and each run delivers there.
- When you give a Bot a connector link, it installs the matching plugin from the catalog when there is one.
- Connect Apps lists the most-installed plugins first, search also finds plugins whose description matches, and a search with no results says so.
- Bots can wait for a background command on their computer to finish, shown as Waiting on results.
- When GitHub refuses a repository or Vercel a team, the Bot suggests ones it can reach or asks you to reconnect.
- Adding an MCP server on a private Tailscale network now explains that Grok Bot can't reach it yet and suggests exposing it with Tailscale Funnel.
- Canvases and documents are both labeled Page.
- Typing # in the composer no longer opens the pull request picker.

### Fixed

- Connector calls fail less often: Bots fix wrongly shaped arguments and accept Notion links and Slack channel names before sending.
- When a connector rate-limits your account, Bots wait for the retry delay instead of calling it in a loop.
- With 1Password connected, browser and computer actions retry through brief connection errors instead of stopping.
- Slack, Gmail, and Outlook drafts retry through temporary rate limits and say if they still couldn't send.
- Slack messages a Bot drafts no longer turn into one raw code block when sent.
- Gmail drafts use your default send-as address and add your own signature, not one quoted from someone else.
- Bot emails with non-English names or subjects no longer bounce, replies to them stay in the same thread, and small images in incoming mail are kept.
- When Agent email is off for your team or account, the Bot says so instead of calling it a temporary problem.
- Files and images Bots send from their computer arrive in the chat, ahead of any question card.
- Opening a file while the Bot's computer is asleep wakes it and opens the file.
- When chats, pages, skills, routines, or plugins fail to load, the app shows the error with Try again and keeps what it last loaded.
- Search finds message text and attachment names in all chats, including the open one.
- The open chat is marked read when you relaunch the app, come back to your computer, or click its row again.
- While a Bot searches the web or reads pages, the chat and Slack show what it's doing, such as Digging around, instead of Working in Cursor.
- The Bot's browser keeps downloads under their own file names and starts again after its profile folder is removed.
- Outlook shows its Authorize card when a change needs more permission, and Bots stop retrying on deleted or protected items.
- All-day calendar events stay on the right date, and Bots check your other calendars before saying an event is missing.
- Plugins installed from chat or the web are ready on the Bot's computer, and local plugins such as Xero get the settings you entered.
- Long messages show Show more right away, so opening a chat no longer jumps.
- Publishing, sharing, or deleting a Bot, and adding one from a template, work while its computer is asleep or unreachable.
- Switching chats or focusing the window no longer wakes a sleeping computer.
- Switching accounts lands on the new account within seconds, even when another computer is asleep.
- Pinned Bots stay in sync between the desktop and the phone.
- If the window keeps crashing, Grok Bot offers to reload it or quit, and a window left blank after an update relaunches.
- Bots no longer sign you out of a connector while repairing it, and a connector account you sign out of stays signed out.
- When a model isn't available in your region, the turn stops and explains why, and Bots fall back to Grok.
- In Slack, Bots answer messages whose thread they can't read, and asking a teammate's Bot no longer adds it to your sidebar.
- Connecting Slack from the dashboard on grok.com now brings you back there to finish linking your Slack account.
- In voice calls, the Bot knows today's date in your time zone instead of sometimes using tomorrow's.
- On Linux, the app stays responsive and can quit while a notification is showing.
- Usage & Billing shows your plan name on Current plan, and the usage meter labels its percentage as used.

October 7, 2026 Oct 7, 2026

v0.68.1

### New

- Your messages in a 1:1 Bot chat take that Bot's color; set Accent to Black in Settings → General to turn it off. Requires Grok Bot 0.64.0 or later.
- Bots can build slide decks with you, showing sample slides to choose from, and deliver them as PowerPoint files or Google Slides.
- Bots can send formatted emails from a draft card, so recipients see headings, bold text, and lists.
- Bots can search your Gmail Spam folder and move a message back to your inbox.
- Team Bots can mention a Slack user group so its members get notified, while @here and @channel still don't ping anyone. Teams

### Improved

- Typing / in the composer no longer opens a menu of skills and actions.
- Bots work faster on their computer: actions settle sooner, screenshots come back quicker, and new windows skip a five-second wait.
- The Bot's computer has a 1920 × 1200 screen, up from 1280 × 800, giving more room when you watch it or take over.
- In Slack threads it follows, a Team Bot stays quiet on untagged replies that don't need it, such as emoji-only replies. Teams

- Gmail actions fail less often: send and reply no longer report a missing tool, and Bots wait out Google's rate limits.
- Email drafts show up as a card in the chat, a Send cut off by Stop still goes out, and attachments keep their file names.
- The Bot's browser recovers from a crashed tab, handles large uploads, and gives up on a stuck page after 25 seconds.
- Stop or a new message ends a Bot that's stuck on an unresponsive step within about 30 seconds.
- Secure Forms fill into the page the Bot has open, and checkout card fields get a Secure Form instead of a screen handoff.
- When X or Vercel needs you to sign in again, the Bot shows a reconnect card instead of retrying or giving up.
- If the app's window crashes, Grok Bot reloads it instead of leaving it blank.

October 5, 2026 Oct 5, 2026

v0.68.0

### New

- Marathi, Tamil, Telugu, Swahili, and Hausa join the Language options in Settings.
- Settings → Computer shows Remove for your other computers, and a removed computer tells you to restart Grok Bot to add it back.
- Email drafts can go out from a verified Gmail send-as address, with a From picker when you have more than one.
- Searching the command palette also finds plugins, and Enter opens the plugin's page.

- Approval cards ask whether to allow the Bot by name and quote its instruction, and Settings calls saved rules Custom Rules.
- Notifications and the per-Bot notification switch now say the Bot is waiting for you.
- Right-click a routine in the details pane for Pause, Resume, Test, Edit, and Delete; clicking a routine no longer opens its detail view.
- Hovering a pull request link shows a preview card with its status and title instead of a plain tooltip.
- Opening the computer full screen shows the live view right away instead of a second Connecting screen.
- The Unassigned section in the sidebar can be dragged, or moved with Move up and Move down, like your own sections.

- Copying or saving a large image, or opening a large JSON or Markdown file, no longer freezes the app.
- Switching chats no longer flashes an empty transcript, and older messages you scrolled back to stay when the app reconnects.
- Gmail draft cards include your signature, logo included, and say Couldn't send this draft when Send doesn't go through.
- Copied replies keep their line breaks and link URLs when you paste them into email, Slack, or plain text.
- Team Bots no longer appear in the primary Bot picker, and a refused change says Team Bots can't be a primary Bot. Teams

October 2, 2026 Oct 2, 2026

### Improved

- Marketplace is now Connect Apps, with category chips under the search, Recommended for you first, and Bot templates on the web.
- While a Bot works, its status uses new phrases like Thinking it through and Working on your computer, without the Bot's name in front.
- Approval cards show when your Ask first rule paused an action or Always allow added a rule, with Edit rule to change it in Settings.
- Connected Google accounts show their email address instead of default on connector cards and in the account list.
- On Windows, Use hardware acceleration is now on by default, as on Mac, and a choice you already made is kept.
- Copy link on a Team Bot shares an x.ai link, and links you already shared keep working. Teams

- Connecting an app finishes even when another app is using its sign-in port, and a failed sign-in page explains why.
- Connector cards that ask you to sign in again, or to add a second account, offer Authorize for that account instead of showing Added.
- When a Gmail reply-all fails, the draft card says Message not delivered instead of showing it as sent.
- Stop in Settings stops every running chat so Update unlocks, and a Settings page that fails after an update offers Restart.
- Routine schedules no longer claim an interval that doesn't repeat, a failed pause or resume shows an error, and deleted routines' chips show (deleted).
- The dock badge no longer counts unread messages from Bots that were deleted.
- On Mac, the Back and Forward buttons on Logitech mice now work.
- Sidebar avatars no longer freeze with one eye bigger than the other.
- When a team admin turns off Route traffic through this computer, Settings → Computer says so, and a failed load of your team's settings offers Retry. Teams

October 2, 2026 Oct 2, 2026

- Your primary Bot, marked with a star, will now spot work it can take off your plate and offer to handle it. Requires Grok Bot 0.59.0 or later.

- In Slack threads, the Bot's status line shows what it's working on and stays up during long steps. Teams

- Update downloads resume after your computer sleeps, and on Mac a copy running from a disk image or Downloads offers Move to Applications.
- A Bot that hangs on an unresponsive command or computer stops itself with a note, and your next message picks up where it left off.
- Your phone notifies you about each Bot reply only once, and never for Bot chats you've deleted.

September 30, 2026 Sep 30, 2026

- Teammates can start a voice chat with a Team Bot, and the call stays in their own conversation with it. Teams

- Automatic Updates is on by default, so Grok Bot restarts to apply updates while you're away; turn it off in Settings → Updates.
- Your phone skips notifications for a Bot you're viewing on your computer, and resumes them once the computer locks, sleeps, or sits idle.
- Team Bot setup goes card to card with no Bot messages in between, and each card shows its step, like Step 2 of 5. Teams

- When you connect an app, sign-in shows why it failed or that its link expired, and Reopen or Retry starts a fresh sign-in.

September 30, 2026 Sep 30, 2026

- Email and Slack draft cards offer Disable drafts for this Bot, so that Bot sends messages directly; ask the Bot to turn drafts back on.
- The creator of a published Team Bot can add teammates under Managers, who can then change its profile, skills, plugins, secrets, and Slack app. Teams

- Bot avatars have a refreshed look with bigger eyes, and the avatar editor adds square, sparkle, clover, flower, heart, house, and star shapes.
- Links in Bot messages show the site's icon next to the underlined link text.
- When a Bot needs a login or other form filled, its chat card opens a Secure Form window showing the site's name and icon.

September 29, 2026 Sep 29, 2026

- In Slack threads, a Bot that needs your approval posts a Review an action card only you can answer, instead of dropping the action. Teams
- You can ask a Team Bot in Slack to message one of your own Bots, and the reply comes to you privately in Grok Bot. Teams

- Adding a plugin that needs sign-in, such as Gmail, from Marketplace starts its sign-in right away instead of stopping at Added.
- Bots move through websites faster, with shorter waits for pages to settle after each click or form submission.
- Marketplace focuses on plugins: Featured Bots and Bot search results no longer appear, and the search box reads Search plugins.
- A Team Bot you own that's ready to publish shows Publish at the top of its details pane, replacing the Publish to team card. Teams

- Grok Bot signs in and connects on networks with a TLS-inspecting proxy, using root certificates installed on your computer.
- When you use up your plan's included usage, Grok Bot shows the usage limit notice instead of Bot failed to respond.
- After a Bot says it's on your request and does the work, it sends you the result instead of going quiet.
- Settings → Usage & Billing shows your included usage and when it resets, instead of saying your plan has none.
- A Bot keeps the voice, speed, and language you set for it instead of resetting them to the defaults.
- In the Tasks tab of a Bot's details pane, deleted or expired cloud agent runs leave the Coding list, and stalled statuses show Status unavailable.
- A Bot you create while the app is open shows its latest message preview and unread dot in the sidebar right away.
- Team Bots with names Slack rejects, such as emoji or non-Latin names, can still be added to Slack under a Slack-safe name. Teams

September 17, 2026 Sep 17, 2026

### Improved

- Bots can work with GitHub releases, tags, labels, sub-issues, discussions, and collaborators, create branches, and submit one pull request review covering several files.
- Review an action cards say in one sentence what the Bot wants to do and keep the command and reasoning behind View the full request.
- Spreadsheet previews let you select cells and ranges, move with the arrow keys, copy with Cmd/Ctrl+C, and show up to 10,000 rows.
- When you tell a Bot to stop, it also stops the other Bots it handed work to and the Cloud Agents it started.

### Fixed

- Marketplace shows plugin changes, such as connecting, disconnecting, removing, or signing in, as soon as they finish.
- Routines that watch a single GitHub pull request run only for events on that pull request.
- Changing a Bot's avatar shape and color applies every pick right away, even when you click through them quickly.
- One-time reminder routines show Once with their date and time.
- Bot computers that are asleep apply an admin's latest Network Controls when they next wake. Enterprise

September 16, 2026 Sep 16, 2026

v0.55.0

### Improved

- The Grok Bot dashboard's Setup Checklist groups steps into Recommended and Optional and adds steps for plugins, Slack or Microsoft Teams, and network settings. Teams
- The About dialog shows when your copy of the app was built, and Copy version info includes the build date.

- Disconnect on the built-in GitHub plugin works even when your Grok Bot computer is unavailable or running an older version.
- When a Bot fills your answers from a chat form into a page, it also fills address and other fields that unlock only when clicked.
- On sign-in pages that keep fields filled while logging you in, the Bot checks whether a 1Password sign-in worked instead of handing you the screen.

September 16, 2026 Sep 16, 2026

v0.54.0

- Organization admins can choose Delete VMs and Data under Manage selected to remove members' Grok Bot computers along with their stored data. Enterprise

- The search palette (Cmd/Ctrl+K) shows matching Bots, settings, actions, and routines before messages; wrap your search in quotes to see every matching message.
- A Bot you create from a template greets you in your app language instead of always in English.

- HEIC and HEIF photos, like those from an iPhone, show as images in the conversation, media viewer, and Media tab instead of as file attachments.
- Bots sign in with 1Password on more sites and let 1Password fill one-time codes and passwords instead of asking you to type them.
- The built-in GitHub plugin appears in Marketplace search with a Connect button, and its page lists its tools so you can turn each one off.
- Secret request cards say why a save failed and keep what you typed so you can try again.

September 15, 2026 Sep 15, 2026

v0.53.0

- On a Mac, connect 1Password from the Marketplace so your Bot can sign in with your saved logins, asking you first unless you turn on Auto fill.
- Bots can upload files to Google Drive or OneDrive, or attach them to a Gmail draft.

- Your Bot's computer uses your time zone, so websites and its clock match where you are.
- Click an open image to zoom in, and close the viewer with Escape, the close button, or a click outside the image.

- Stopping your Bot also stops anything still running on its computer.
- Bots fill sign-in fields even when they sit partly off the screen.
- Phone notifications show your Bot's picture.
- You can finish connecting Bitbucket from Grok Bot.
- A Bot created by another Bot now shows up in your sidebar.
`;
