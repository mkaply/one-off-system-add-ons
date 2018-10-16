This system add-on adds in-content organic and follow-on searches to older versions of Firefox.
It does this by porting https://bugzilla.mozilla.org/show_bug.cgi?id=1482158 and
https://bugzilla.mozilla.org/show_bug.cgi?id=1475571 to older version os Firefox.

It's intended to be run on Firefox versions below 64 (64 adds this code).
Google organic was added in 62.0.1, so this does not record Google for versions
over 62.0.1.

This add-on must be run at startup, so it can't be tested via about:debugging - it
has to use a proxy file or come from the test server.

It uses the same ID as the old followonsearch to make sure the two aren't installed
together.