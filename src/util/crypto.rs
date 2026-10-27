use crate::util::hash::md5_hex;
use base64::engine::{general_purpose::STANDARD, Engine as _};
use hmac::Hmac;
use pbkdf2::pbkdf2;
use rand::{distributions::Alphanumeric, Rng};
use sha2::Sha256;

pub const PBKDF2_ITERATIONS: u32 = 100_000;
pub const PBKDF2_PREFIX: &str = "$pbkdf2$";

pub fn random_string(len: usize) -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(len)
        .map(char::from)
        .collect()
}

/// Legacy double-MD5 password hash (kept for backward compatibility).
pub fn gen_encrypted_password(password: &str, salt: &str) -> String {
    let first = md5_hex(&format!("{}{}", password, salt));
    md5_hex(&format!("{}{}", first, salt))
}

/// Generate a PBKDF2-HMAC-SHA256 password hash with version prefix.
/// Format: `$pbkdf2$<iterations>$<base64_hash>` (salt stored separately).
pub fn gen_secure_password(password: &str, salt: &str) -> String {
    let mut out = [0u8; 32];
    pbkdf2::<Hmac<Sha256>>(
        password.as_bytes(),
        salt.as_bytes(),
        PBKDF2_ITERATIONS,
        &mut out,
    )
    .expect("pbkdf2 derivation failed");
    format!(
        "{}{}${}",
        PBKDF2_PREFIX,
        PBKDF2_ITERATIONS,
        STANDARD.encode(out)
    )
}

/// Verify a password against a stored hash, supporting both legacy
/// double-MD5 and PBKDF2 formats. Returns true if the password matches.
pub fn verify_password(password: &str, salt: &str, stored_hash: &str) -> bool {
    if stored_hash.starts_with(PBKDF2_PREFIX) {
        let parts: Vec<&str> = stored_hash.split('$').collect();
        if parts.len() != 4 {
            return false;
        }
        let iterations: u32 = match parts[2].parse() {
            Ok(v) => v,
            Err(_) => return false,
        };
        let expected_hash = match STANDARD.decode(parts[3]) {
            Ok(h) => h,
            Err(_) => return false,
        };
        let mut out = [0u8; 32];
        pbkdf2::<Hmac<Sha256>>(password.as_bytes(), salt.as_bytes(), iterations, &mut out)
            .expect("pbkdf2 derivation failed");
        out.as_slice() == expected_hash.as_slice()
    } else {
        // Legacy double-MD5
        gen_encrypted_password(password, salt) == stored_hash
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pbkdf2_roundtrip() {
        let password = "password123";
        let salt = "salt1234";
        let hash = gen_secure_password(password, salt);
        assert!(hash.starts_with("$pbkdf2$"));
        assert!(verify_password(password, salt, &hash));
        assert!(!verify_password("wrong", salt, &hash));
    }

    #[test]
    fn test_legacy_still_works() {
        let password = "password123";
        let salt = "salt1234";
        let hash = gen_encrypted_password(password, salt);
        assert!(!hash.starts_with("$pbkdf2$"));
        assert!(verify_password(password, salt, &hash));
    }
}
