# Microsoft Edge Add-ons submission notes

## Single purpose

Page Inbox is a local page collection tool. It saves web page links into browser local storage so the user can review, tag, mark as done, copy as Markdown, or export the saved list later.

## Permission justification

- `activeTab`: Reads the currently active tab only after the user clicks the popup save button or the context menu command.
- `contextMenus`: Adds page and link context menu entries so the user can save pages or links from Microsoft Edge.
- `scripting`: Runs a small user-triggered script in the active tab to read the page title and description metadata.
- `storage`: Stores the saved page list, tags, notes, and status locally in `chrome.storage.local`.

## Remote code

No remote code is loaded or executed. All JavaScript, HTML, CSS, and localization files are packaged with the extension.

## Data usage

The extension stores saved URLs, page titles, optional page descriptions, tags, notes, status, and timestamps in the user's local browser storage. It does not transmit this data to a server. Manual exports create local JSON or Markdown files at the user's request.

## Certification testing notes

1. Load the unpacked extension folder in Microsoft Edge.
2. Open any `https://` page and click the extension icon.
3. Click **Save current page**.
4. Add a manual URL, add tags and a note, mark an item done, copy Markdown, and export JSON or Markdown.
5. Right-click a page or link and use the Page Inbox context menu entry.
