@description('Name of the image account. Distinct from the chat account because the two live in different regions.')
param name string

@description('Region for the image account. MAI image models are offered in a different set of regions than the chat model.')
param location string

param tags object

@description('MAI image model to deploy, e.g. "MAI-Image-2.5".')
param modelName string

param modelVersion string

@description('Images per minute.')
param capacity int

// This lives in its own module so that the account and its keys are only ever
// *referenced* from a scope that is guaranteed to have deployed them. Calling
// `listKeys()` on a conditional resource from the parent template raises BCP422
// — ARM does not reliably short-circuit the guarding ternary, and the deploy
// fails resolving a resource that was never created.
resource account 'Microsoft.CognitiveServices/accounts@2026-05-01' = {
  name: name
  location: location
  tags: tags
  kind: 'AIServices'
  sku: { name: 'S0' }
  identity: { type: 'SystemAssigned' }
  properties: {
    customSubDomainName: name
    publicNetworkAccess: 'Enabled'
  }
}

resource modelDeployment 'Microsoft.CognitiveServices/accounts/deployments@2026-05-01' = {
  parent: account
  name: modelName
  sku: {
    name: 'GlobalStandard'
    capacity: capacity
  }
  properties: {
    model: {
      // Not 'OpenAI': MAI models are published by Microsoft, and the format is
      // what routes the deployment to the right model family.
      format: 'Microsoft'
      name: modelName
      version: modelVersion
    }
  }
}

// The Foundry host, not the `openai.azure.com` one the chat model answers on:
// `/mai/v1/images/edits` does not exist on the latter.
output endpoint string = 'https://${name}.services.ai.azure.com/'

@secure()
output key string = account.listKeys().key1
