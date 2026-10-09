# Call Flow

Minimal press-to-call demo app. Spec: [../Requirements/CallFlow.md](../Requirements/CallFlow.md).

Search → Find → Call → Take Notes → End Call → History

## Run

```bash
npm install
npm run dev        # http://localhost:5174
```

No backend, no network, no keys. Business data is mocked in `src/data/businesses.js`. Call history lives in local storage.

## Before going on stage

Open History and tap **Clear history** so the table starts empty. That is the payoff moment.

## Structure

```
src/
  App.jsx                   screen routing + call state machine (idle → dialing → connected → ended)
  data/businesses.js        mock dataset, 5 per category, plus search
  lib/format.js             timer and date formatting
  lib/storage.js            local storage read/write
  components/
    SearchScreen.jsx        search box, quick chips, result cards
    BusinessDetail.jsx      sparse detail view, big Call button
    ActiveCall.jsx          dialing / connected states, timer, notes, outcome pills, End Call
    CallComplete.jsx        confirmation banner, auto-routes to History
    HistoryScreen.jsx       history table, Clear history
    NoteDetail.jsx          saved record with full notes
```
