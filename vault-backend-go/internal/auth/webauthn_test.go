package auth

import (
	"testing"
)

func TestVerifyWebAuthnAssertion_Compile(t *testing.T) {
	// This test just ensures the function exists and compiles.
	// We can't easily test with real WebAuthn data without complex mocking.
	_ = VerifyWebAuthnAssertion
}
