// ---------------------------------------------------------------------------
// Cost alerting
//
// Almost everything this template provisions is metered by use rather than
// billed at a flat monthly rate, and the metered parts are driven by whatever
// the app's users happen to do: every parse, enrichment and recommendation
// spends Azure OpenAI tokens, every photo spends a Vision transaction. The
// failure this guards against is not a bill that is steadily higher than
// expected — it is a retry loop or a runaway client spending for days before
// anyone thinks to look at the portal.
//
// Two budgets rather than one. The wide one answers "is this month unusual?";
// the AI-only one answers "unusual *where*?". A single subscription-wide number
// can tell you something is wrong but not what, and the AI accounts are the
// only resources here whose cost has no ceiling of its own.
//
// A budget alerts. It does not cap: Azure will not stop the spend when the
// threshold trips, and nothing in this file changes that. Real enforcement
// belongs in the application, where a per-user or per-day quota can refuse the
// call before it is billed.
// ---------------------------------------------------------------------------

@description('Suffix that makes the budget names unique within the subscription.')
param resourceToken string

@description('Monthly ceiling for the whole resource group, in the billing account currency.')
param amount int

@description('Monthly ceiling for the AI accounts alone. Lower than the group ceiling on purpose: it should trip first, because it is the more actionable of the two.')
param aiAmount int

@description('First day of the month the budget starts tracking, as yyyy-MM-01. Supplied by the caller because utcNow() is only legal in a parameter default.')
param startDate string

@description('Comma-separated addresses that receive the alerts.')
param contactEmails string

@description('Resource ids of the AI accounts the second budget watches.')
param aiResourceIds array

var emails = filter(map(split(contactEmails, ','), email => trim(email)), email => !empty(email))

// Cost Management stores resource ids lower-cased, and the ResourceId filter is
// matched literally. An id carrying the casing Bicep produces silently matches
// nothing, which would leave a budget that can never fire.
var aiScope = map(aiResourceIds, id => toLower(id))

resource alerts 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: 'ag-cost-${resourceToken}'
  location: 'Global'
  properties: {
    groupShortName: 'coffeecost'
    enabled: true
    emailReceivers: [
      for (email, index) in emails: {
        name: 'email${index}'
        emailAddress: email
        useCommonAlertSchema: true
      }
    ]
  }
}

// Both the action group and the addresses are listed. The action group is the
// seam — routing can grow into a webhook or a phone number later without
// touching the budget — but naming the addresses directly means an alert still
// arrives if the group is ever emptied by accident.
var notifications = {
  // Early enough to be a fact rather than a problem: at half the budget in the
  // first week, something has changed.
  Actual_50: {
    enabled: true
    operator: 'GreaterThan'
    threshold: 50
    thresholdType: 'Actual'
    contactEmails: emails
    contactGroups: [alerts.id]
  }
  Actual_80: {
    enabled: true
    operator: 'GreaterThan'
    threshold: 80
    thresholdType: 'Actual'
    contactEmails: emails
    contactGroups: [alerts.id]
  }
  Actual_100: {
    enabled: true
    operator: 'GreaterThan'
    threshold: 100
    thresholdType: 'Actual'
    contactEmails: emails
    contactGroups: [alerts.id]
  }
  // The only one that warns rather than reports. Actual-cost alerts confirm the
  // money is already spent; a forecast crossing the ceiling mid-month is the
  // signal there is still time to act on.
  Forecasted_100: {
    enabled: true
    operator: 'GreaterThan'
    threshold: 100
    thresholdType: 'Forecasted'
    contactEmails: emails
    contactGroups: [alerts.id]
  }
}

resource groupBudget 'Microsoft.Consumption/budgets@2023-05-01' = {
  name: 'budget-${resourceToken}'
  properties: {
    category: 'Cost'
    amount: amount
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: startDate
    }
    notifications: notifications
  }
}

resource aiBudget 'Microsoft.Consumption/budgets@2023-05-01' = {
  name: 'budget-ai-${resourceToken}'
  properties: {
    category: 'Cost'
    amount: aiAmount
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: startDate
    }
    filter: {
      dimensions: {
        name: 'ResourceId'
        operator: 'In'
        values: aiScope
      }
    }
    notifications: notifications
  }
}

output actionGroupName string = alerts.name
output budgetNames array = [groupBudget.name, aiBudget.name]
