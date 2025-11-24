package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/md5"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"

	"golang.org/x/crypto/pbkdf2"
)

// deriveKey uses PBKDF2 to derive a key from password and salt, matching CryptoJS
func deriveKey(password, salt string) []byte {
	key := pbkdf2.Key([]byte(password), []byte(salt), 10000, 32, sha256.New)
	// CryptoJS returns hex string, we need to convert it back
	return []byte(hex.EncodeToString(key))
}

// evpKDF mimics OpenSSL's EVP_BytesToKey used by CryptoJS
func evpKDF(password, salt []byte, keySize, ivSize int) ([]byte, []byte) {
	var (
		concat   []byte
		lastHash []byte
	)

	totalSize := keySize + ivSize
	for len(concat) < totalSize {
		hash := md5.New()
		hash.Write(lastHash)
		hash.Write(password)
		hash.Write(salt)
		lastHash = hash.Sum(nil)
		concat = append(concat, lastHash...)
	}

	return concat[:keySize], concat[keySize:totalSize]
}

// decrypt decrypts CryptoJS AES encrypted data
func decrypt(ciphertext []byte, keyHex []byte) (string, error) {
	// CryptoJS format: "Salted__" + 8 bytes salt + ciphertext
	data, err := base64.StdEncoding.DecodeString(string(ciphertext))
	if err != nil {
		return "", err
	}

	// Check for "Salted__" prefix (CryptoJS format)
	if len(data) < 16 || string(data[:8]) != "Salted__" {
		return "", errors.New("invalid ciphertext format")
	}

	salt := data[8:16]
	encrypted := data[16:]

	// Derive key and IV using the password (keyHex is the password in this case)
	key, iv := evpKDF(keyHex, salt, 32, 16)

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}

	if len(encrypted)%aes.BlockSize != 0 {
		return "", errors.New("ciphertext is not a multiple of the block size")
	}

	mode := cipher.NewCBCDecrypter(block, iv)
	decrypted := make([]byte, len(encrypted))
	mode.CryptBlocks(decrypted, encrypted)

	// Remove PKCS7 padding
	padding := int(decrypted[len(decrypted)-1])
	if padding > aes.BlockSize || padding == 0 {
		return "", errors.New("invalid padding")
	}

	return string(decrypted[:len(decrypted)-padding]), nil
}

// encrypt encrypts data using CryptoJS-compatible format
func encrypt(plaintext string, keyHex []byte) string {
	// Generate random salt
	salt := make([]byte, 8)
	// For now, use a simple salt generation
	for i := range salt {
		salt[i] = byte(i)
	}

	// Derive key and IV
	key, iv := evpKDF(keyHex, salt, 32, 16)

	// Add PKCS7 padding
	padding := aes.BlockSize - (len(plaintext) % aes.BlockSize)
	padtext := make([]byte, len(plaintext)+padding)
	copy(padtext, plaintext)
	for i := len(plaintext); i < len(padtext); i++ {
		padtext[i] = byte(padding)
	}

	block, _ := aes.NewCipher(key)
	ciphertext := make([]byte, len(padtext))
	mode := cipher.NewCBCEncrypter(block, iv)
	mode.CryptBlocks(ciphertext, padtext)

	// Prepend "Salted__" + salt
	result := make([]byte, 8+8+len(ciphertext))
	copy(result[:8], []byte("Salted__"))
	copy(result[8:16], salt)
	copy(result[16:], ciphertext)

	return base64.StdEncoding.EncodeToString(result)
}

func hashNoteID(noteID string) string {
	hash := sha256.Sum256([]byte(noteID))
	return hex.EncodeToString(hash[:])[:12]
}
