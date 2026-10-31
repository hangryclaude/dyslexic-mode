Keep the retry loop if a timeout is set.
Remove it only if no timeout is set.

A retry loop can hide a hang.
Before you remove it, check that no caller depends on it.

Also check the default timeout. It must be above zero.
