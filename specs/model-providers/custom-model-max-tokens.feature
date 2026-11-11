Feature: Max Tokens is universal for chat models
  Every chat model is token-based and accepts a max_tokens limit at invocation time.
  The Max Tokens slider must always render in the LLM config popover for chat
  models, regardless of what supportedParameters the model entry declares. There
  is no opt-out at the model-registration level.

  # All scenarios describe the LLM Config popover and the Add Custom Model
  # dialog (slider visibility, parameter checkboxes). Need a JSDOM render of
  # `LLMConfigPopover` + `AddCustomModelDialog`. Aspirational pending those
  # popover harnesses.

  This contract was tightened after a managed-Bedrock customer registered a
  custom chat model whose supportedParameters list did not include max_tokens
  (the previous default). The popover then hid the slider after the model
  metadata loaded — a flicker, then nothing — leaving the user unable to set
  per-invocation output limits.

  @integration @unimplemented
  Scenario: Max Tokens slider always renders for a chat model with a token ceiling
    Given a chat model whose stored supportedParameters does NOT include "max_tokens"
    And the model has a configured maxTokens ceiling
    When a user opens the LLM Config popover for that model
    Then the Max Tokens slider is visible
    And the slider's maximum equals the model's configured maxTokens ceiling

  @integration @unimplemented
  Scenario: Max Tokens slider renders without a flicker for managed-Bedrock custom models
    Given a managed Bedrock provider configured for the organization
    And the admin has registered a Bedrock chat model with supportedParameters ["temperature"]
    When a user opens an LLM-as-judge evaluator drawer for that model
    Then the Max Tokens slider is visible from first paint
    And it does not disappear after model metadata finishes loading

  @integration @unimplemented
  Scenario: Add Custom Model dialog does not expose Max Tokens as a supported-parameter checkbox
    Given I am an org admin on the model provider settings page
    When I open the Add Custom Model dialog for a chat model
    Then the Supported Parameters checkbox list does NOT include "Max Tokens"
    And the numeric "Max Tokens" field above (the model's ceiling) is still required

  @integration @unimplemented
  Scenario: Max Tokens slider renders for a reasoning chat model
    Given a chat model that supports the unified reasoning parameter
    And the model entry's supportedParameters list omits "max_tokens"
    When a user opens the LLM Config popover for that model
    Then the Max Tokens slider is visible alongside the Reasoning selector

  # A custom model registered before the Max Tokens field existed carries no
  # ceiling, and its metadata reports a context length of 0. Read as a limit,
  # that 0 became the max tokens a model switch saved (which the provider then
  # refused) and a slider capped at its floor of 512.
  @unit
  Scenario: A custom model with no Max Tokens ceiling falls back to the default limit
    Given a custom chat model registered without a Max Tokens ceiling
    When its token limit is read for the LLM config
    Then the limit is the default of 4096, not zero
    And switching to that model sets max tokens to the default, never to 0

  # The custom model dialog opens from inside the provider form. Its Save used
  # to submit that form too, with the list from before the edit, so a new Max
  # Tokens ceiling never reached the server and the drawer closed as if saved.
  @integration
  Scenario: A custom model's new Max Tokens ceiling is saved with its provider
    Given a saved provider with a custom chat model that has no Max Tokens ceiling
    When the user edits that model, sets Max Tokens to 32768 and saves the model dialog
    Then the provider is not saved yet
    And saving the provider sends the model with its Max Tokens of 32768

  # The browser sends each custom model with its ceiling and capabilities. The
  # tRPC transport kept only the id and the label, both on save and on the way
  # back, so the ceiling was dropped and the editor never showed it again.
  @unit
  Scenario: The server keeps a custom model's Max Tokens ceiling on save and sends it back
    Given a provider saved with a custom chat model whose Max Tokens is 32768
    When the save is written and the provider is read back
    Then the stored model keeps its Max Tokens of 32768 and its supported parameters
    And the provider read back carries the same ceiling and parameters

  @integration @unimplemented
  Scenario: Embedding popovers are unaffected
    Given an embedding model
    When a user opens the embedding configuration UI
    Then no Max Tokens slider is rendered
