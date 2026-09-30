# Markdown task lists (#64)

In chat messages and reasoning, render `- [ ] Pending` and `- [x] Complete`, including nested items mixed with ordinary bullets. Verify native-sized checkboxes, aligned labels, no duplicate bullets, and wrapping on a narrow sidebar. Check settings toggles remain 18px, aligned and clickable. Text, search, password, number, email, URL and inputs without a type retain text-field styling.

The toggle still needs its explicit 18px sizing and flex alignment; only the redundant padding reset is removed.
