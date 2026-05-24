package auth

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"errors"
	"fmt"
)

// VerifyWebAuthnAssertion verifies a WebAuthn assertion signature (Manual Bridge pattern).
// Sourced from industry-standard WebAuthn verification logic.
func VerifyWebAuthnAssertion(
	pubKeyB64 string,
	signatureB64 string,
	clientDataJSONB64 string,
	authenticatorDataB64 string,
	expectedChallenge string,
) error {
	// 1. Decode all base64 inputs
	pubKeyBytes, err := base64.StdEncoding.DecodeString(pubKeyB64)
	if err != nil {
		return fmt.Errorf("failed to decode public key: %w", err)
	}

	signature, err := base64.StdEncoding.DecodeString(signatureB64)
	if err != nil {
		return fmt.Errorf("failed to decode signature: %w", err)
	}

	clientDataJSON, err := base64.StdEncoding.DecodeString(clientDataJSONB64)
	if err != nil {
		return fmt.Errorf("failed to decode clientDataJSON: %w", err)
	}

	authenticatorData, err := base64.StdEncoding.DecodeString(authenticatorDataB64)
	if err != nil {
		return fmt.Errorf("failed to decode authenticatorData: %w", err)
	}

	// 2. Verify that 'clientDataJSON' contains the 'expectedChallenge'
	if !bytes.Contains(clientDataJSON, []byte(expectedChallenge)) {
		return errors.New("clientDataJSON does not contain expected challenge")
	}

	// 3. Hash the 'clientDataJSON' using SHA-256
	clientDataHash := sha256.Sum256(clientDataJSON)

	// 4. Concatenate 'authenticatorData' + 'clientDataHash'
	verificationData := append(authenticatorData, clientDataHash[:]...)

	// 5. Hash the result again using SHA-256
	finalHash := sha256.Sum256(verificationData)

	// 6. Parse the public key (Expected to be SPKI/PKIX encoded P-256)
	genericPubKey, err := x509.ParsePKIXPublicKey(pubKeyBytes)
	if err != nil {
		return fmt.Errorf("failed to parse public key: %w", err)
	}

	ecdsaPubKey, ok := genericPubKey.(*ecdsa.PublicKey)
	if !ok {
		return errors.New("public key is not an ECDSA public key")
	}

	// 7. Verify the 'signature' (ASN.1 DER) against the final hash
	if !ecdsa.VerifyASN1(ecdsaPubKey, finalHash[:], signature) {
		return errors.New("invalid WebAuthn signature")
	}

	return nil
}
