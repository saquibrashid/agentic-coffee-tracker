# Infrastructure

Bicep templates land here.

See `specs/architecture.md` for the planned topology:

- Azure Static Web Apps (Standard) hosting the client
- Linked Azure Functions for the BFF endpoints
- Key Vault for `AZURE_VISION_*` and `AZURE_OPENAI_*`
- Application Insights with sampling

## Files

| File                 | Contains                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| `main.bicep`         | Subscription-scoped entry point: the resource group and the parameters `azd` fills in           |
| `resources.bicep`    | Everything inside the resource group                                                            |
| `imageAccount.bicep` | The MAI image account, which needs its own region and so cannot be a deployment on the chat one |
| `budget.bicep`       | Cost budgets and the action group that delivers their alerts                                    |

## Cost alerts

`budget.bicep` provisions a resource-group budget and a second one filtered to the AI accounts, both alerting at 50/80/100% of actual spend and 100% of forecast. It is scoped to the resource group rather than the subscription on purpose: a subscription budget would also fire on unrelated work in the same subscription, which is the fastest way to teach yourself to ignore it.

Nothing is created until `BUDGET_CONTACT_EMAILS` is set — see [`docs/deployment.md`](../docs/deployment.md#budget-alerts) for the reasoning, the tuning knobs, and the two cases where budgets are unavailable.
