package auth

import (
	"crypto/ecdsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
)

// decodeBase64 is a robust decoder that handles standard, URL-safe, and unpadded base64.
func decodeBase64(s string) ([]byte, error) {
	s = strings.TrimSpace(s)
	// Try standard encoding first
	if b, err := base64.StdEncoding.DecodeString(s); err == nil {
		return b, nil
	}
	// Try URL encoding
	if b, err := base64.URLEncoding.DecodeString(s); err == nil {
		return b, nil
	}
	// Try unpadded standard
	if b, err := base64.RawStdEncoding.DecodeString(s); err == nil {
		return b, nil
	}
	// Try unpadded URL
	return base64.RawURLEncoding.DecodeString(s)
}

// VerifyWebAuthnAssertion verifies a WebAuthn assertion signature (Manual Bridge pattern).
func VerifyWebAuthnAssertion(
	pubKeyB64 string,
	signatureB64 string,
	clientDataJSONB64 string,
	authenticatorDataB64 string,
	expectedChallenge string,
) error {
	// 1. Decode all base64 inputs using robust decoder
	pubKeyBytes, err := decodeBase64(pubKeyB64)
	if err != nil {
		return fmt.Errorf("failed to decode public key: %w", err)
	}

	signature, err := decodeBase64(signatureB64)
	if err != nil {
		return fmt.Errorf("failed to decode signature: %w", err)
	}

	clientDataJSON, err := decodeBase64(clientDataJSONB64)
	if err != nil {
		return fmt.Errorf("failed to decode clientDataJSON: %w", err)
	}

	authenticatorData, err := decodeBase64(authenticatorDataB64)
	if err != nil {
		return fmt.Errorf("failed to decode authenticatorData: %w", err)
	}

	// 2. Parse clientDataJSON to extract and verify the challenge
	var clientData struct {
		Challenge string `json:"challenge"`
		Origin    string `json:"origin"`
		Type      string `json:"type"`
	}
	if err := json.Unmarshal(clientDataJSON, &clientData); err != nil {
		return fmt.Errorf("failed to parse clientDataJSON: %w", err)
	}

	// WebAuthn challenge in JSON is Base64URL encoded version of the original bytes.
	// We passed the 'expectedChallenge' (nonce string) as the challenge to the browser.
	// The browser converts that string to bytes, then base64url encodes it.
	expectedBase64URL := base64.RawURLEncoding.EncodeToString([]byte(expectedChallenge))

	if clientData.Challenge != expectedBase64URL {
		// FALLBACK: Some browsers might use padded encoding or different formats
		paddedExpected := base64.URLEncoding.EncodeToString([]byte(expectedChallenge))
		if clientData.Challenge != paddedExpected && !strings.Contains(string(clientDataJSON), expectedChallenge) {
			log.Printf("[DEBUG] WebAuthn Challenge Mismatch: Got=%s, Expected=%s", clientData.Challenge, expectedBase64URL)
			return errors.New("clientDataJSON challenge mismatch")
		}
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
