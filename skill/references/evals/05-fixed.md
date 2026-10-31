Staging works. Production is not proven yet.
The Stripe webhook is untested.

## Checked

- The health check returned 200 in 140 ms.

```text
https://staging.example.com/health
```

- All 38 unit tests passed before the deploy.
- Migration 0042 ran with no errors in the deploy log.

## Assumed, not checked

- `STRIPE_KEY` is set correctly.
  The deploy log showed no complaint. I never looked at the value.

## Not tested

- The Stripe webhook.
- The rollback path.
  If production breaks, we may not be able to undo the change cleanly.

## Verdict

The new billing page looks fine for production.
Test the webhook and the rollback first.
