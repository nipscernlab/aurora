// src/translation/float_translator.rs

use std::sync::Arc;
use num_bigint::BigUint;
use std::str::FromStr;
use std::fmt::Write;

use surfer_translation_types::translator::{BasicTranslator, TranslationPreference};
use surfer_translation_types::{VariableMeta, VariableValue, ValueKind};
use anyhow::Result;

/// Tradutor para decodificar um float customizado conforme float2gtkw.c:
/// - 8 bits para nbm, 8 bits para nbe, depois nbi = nbm+nbe+1 bits do valor.
/// - Lógica de sinal + expoente em complemento invertido + mantissa inteira.
/// - Formato de saída: "%.3f".
pub struct FloatTranslator {}

impl FloatTranslator {
    pub fn new() -> Self {
        Self {}
    }

    /// Converte BigUint em string binária com zero-padding até num_bits.
    fn biguint_to_bin_str(v: &BigUint, num_bits: u64) -> String {
        let mut s = v.to_str_radix(2);
        let target_len = num_bits as usize;
        if s.len() < target_len {
            let mut padded = String::with_capacity(target_len);
            for _ in 0..(target_len - s.len()) {
                padded.push('0');
            }
            padded.push_str(&s);
            padded
        } else if s.len() > target_len {
            // Em princípio v < 2^num_bits, mas se houver excesso, pega os bits menos significativos
            s.split_off(s.len() - target_len)
        } else {
            s
        }
    }

    /// Decodifica sinal/expoente/mantissa conforme float2gtkw.c:
    /// sign_bit: "0" ou "1"; expo_bits: nbe bits; mant_bits: nbm bits.
    fn decode_custom_float(sign_bit: &str, expo_bits: &str, mant_bits: &str) -> f64 {
        // Sinal
        let negative = sign_bit == "1";

        // Expoente em complemento invertido
        let mut expo_chars: Vec<char> = expo_bits.chars().collect();
        let e: i32 = if let Some(&first) = expo_chars.get(0) {
            if first == '1' {
                // inverte bits
                for b in expo_chars.iter_mut() {
                    *b = if *b == '1' { '0' } else { '1' };
                }
                let expo_str: String = expo_chars.iter().collect();
                let val = i32::from_str_radix(&expo_str, 2).unwrap_or(0);
                -(val + 1)
            } else {
                let expo_str: String = expo_chars.iter().collect();
                i32::from_str_radix(&expo_str, 2).unwrap_or(0)
            }
        } else {
            0
        };

        // Mantissa inteira
        let mant_val: u64 = if mant_bits.is_empty() {
            0
        } else {
            u64::from_str_radix(mant_bits, 2).unwrap_or(0)
        };

        // f = m * 2^e
        let mut f = (mant_val as f64) * 2f64.powi(e);
        if negative {
            f = -f;
        }
        f
    }
}

impl<VarId, ScopeId> BasicTranslator<VarId, ScopeId> for FloatTranslator {
    fn name(&self) -> String {
        "Float Custom".to_string()
    }

    fn basic_translate(&self, num_bits: u64, value: &VariableValue) -> (String, ValueKind) {
        match value {
            VariableValue::BigUint(v) => {
                // Converte para string binária de comprimento num_bits
                let bin = Self::biguint_to_bin_str(v, num_bits);

                // Precisamos pelo menos 16 bits para nbm (8) + nbe (8)
                if bin.len() < 16 {
                    return ("<len<16>".to_string(), ValueKind::Normal);
                }
                // Extrai primeiros 8 bits = nbm, próximos 8 bits = nbe
                let ma_str = &bin[0..8];
                let ex_str = &bin[8..16];
                let nbm = usize::from_str_radix(ma_str, 2).unwrap_or(0);
                let nbe = usize::from_str_radix(ex_str, 2).unwrap_or(0);
                let nbi = nbm + nbe + 1;
                let expected = 16 + nbi;
                if bin.len() < expected {
                    // bits insuficientes
                    return (format!("<len<{}>", expected), ValueKind::Normal);
                }
                // Extrai bits do valor: a partir de índice 16, comprimento nbi
                let val_str = &bin[16..16 + nbi];
                // Dentro de val_str: [0]=sinal; [1..1+nbe)=expoente; [1+nbe..)=mantissa
                if val_str.len() < 1 + nbe + nbm {
                    return ("<sub-len-incorreto>".to_string(), ValueKind::Normal);
                }
                let sign_bit = &val_str[0..1];
                let expo_bits = &val_str[1..1 + nbe];
                let mant_bits = &val_str[1 + nbe..1 + nbe + nbm];
                let f = Self::decode_custom_float(sign_bit, expo_bits, mant_bits);
                // Formata com três casas decimais
                let mut s = String::new();
                write!(&mut s, "{:.3}", f).ok();
                (s, ValueKind::Normal)
            }
            VariableValue::String(s_in) => {
                // Repassa valores não-binários (X/Z etc.)
                (s_in.clone(), ValueKind::Normal)
            }
        }
    }

    fn translates(&self, variable: &VariableMeta<VarId, ScopeId>) -> Result<TranslationPreference> {
        let width = variable.num_bits;
        if width >= 16 {
            Ok(TranslationPreference::Yes)
        } else {
            Ok(TranslationPreference::No)
        }
    }
}
