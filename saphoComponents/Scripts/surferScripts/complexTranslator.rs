// src/translation/complex_translator.rs
use std::sync::Arc;
use num_bigint::BigUint;
use num_traits::Zero;
use std::str::FromStr;
use std::fmt::Write;

use surfer_translation_types::translator::{BasicTranslator, TranslationPreference};
use surfer_translation_types::{VariableMeta, VariableValue, ValueKind, VariableInfo};
use anyhow::Result;

// Substitua VarId, ScopeId pelos tipos usando em Surfer,
// normalmente Surfer define type VarId e ScopeId em algum módulo,
// ou use parâmetros genéricos conforme os exemplos internos.
//
// Aqui usamos genéricos: T e U (VarId, ScopeId)
pub struct ComplexTranslator {}

impl ComplexTranslator {
    pub fn new() -> Self {
        Self {}
    }

    /// Função auxiliar para converter uma string de bits (com '0'/'1') em f64
    /// seguindo a lógica de b2mf do C: sinal, expoente com complemento invertido, mantissa inteira.
    fn bits_to_float(bitstr: &str) -> f64 {
        let len = bitstr.len();
        if len == 0 {
            return 0.0;
        }
        // sinal
        let sign = bitstr.chars().next().unwrap();
        let negative = sign == '1';

        // Suponha que bitstr.len() = 1 + nbe + nbm.
        // Para deduzir nbe e nbm, essa função assume que o chamador já extraiiu os substrings corretos
        // Portanto, aqui, bitstr é exatamente da forma: [sign][expoente bits][mantissa bits].
        // Precisamos conhecer nbe para dividir; mas no nosso uso, chamaremos bits_to_float apenas
        // com substrings já separadas de tamanho conhecido.

        // Contudo, aqui bits_to_float só será usada quando sabemos nbe. 
        // Então esta função poderia receber diretamente (sign, &expo_bits, &mant_bits).
        // Simplesmente vamos implementar externamente.

        // Esta versão não será usada; em vez disso usaremos outra função abaixo.
        0.0
    }

    /// Converte três pedaços: sign_bit_str (1 char), expo_bits_str (nbe chars), mant_bits_str (nbm chars)
    fn decode_custom_float(sign_bit: &str, expo_bits: &str, mant_bits: &str) -> f64 {
        // Sinal
        let negative = sign_bit == "1";

        // Expoente: expo_bits é string de '0'/'1' de tamanho nbe
        let mut expo_vec: Vec<char> = expo_bits.chars().collect();
        // Se bit mais significativo de expoente é '1', invert bits e e = -(valor+1)
        let first_exp_bit = expo_vec[0];
        let mut e: i32;
        if first_exp_bit == '1' {
            // invert bits
            for b in expo_vec.iter_mut() {
                *b = if *b == '1' { '0' } else { '1' };
            }
            let expo_str: String = expo_vec.iter().collect();
            let val = i32::from_str_radix(&expo_str, 2).unwrap_or(0);
            e = -(val + 1);
        } else {
            // positivo
            let expo_str: String = expo_vec.iter().collect();
            e = i32::from_str_radix(&expo_str, 2).unwrap_or(0);
        }

        // Mantissa inteira
        let mant_val = if mant_bits.is_empty() {
            0u64
        } else {
            u64::from_str_radix(mant_bits, 2).unwrap_or(0u64)
        };

        // Valor float: m * 2^e
        // Se e for muito grande negativo, powi pode retornar zero, mas mantemos lógica simples.
        let mut f = (mant_val as f64) * 2f64.powi(e);
        if negative {
            f = -f;
        }
        f
    }

    /// Converte BigUint v (representando bits) em string binária com zero-padding até num_bits
    fn biguint_to_bin_str(v: &BigUint, num_bits: u64) -> String {
        // Converte para string binária sem prefixo, depois preenche à esquerda com zeros
        let mut s = v.to_str_radix(2);
        let target_len = num_bits as usize;
        if s.len() < target_len {
            let mut padded = String::with_capacity(target_len);
            for _ in 0..(target_len - s.len()) {
                padded.push('0');
            }
            padded.push_str(&s);
            padded
        } else {
            // Se tiver mais bits do que num_bits, mantém apenas os menos significativos? Ou truncar os bits superiores?
            // Em geral, v < 2^num_bits, mas, por segurança, se len > target_len, pega últimos target_len bits.
            s.split_off(s.len() - target_len)
        }
    }
}

impl<VarId, ScopeId> BasicTranslator<VarId, ScopeId> for ComplexTranslator {
    fn name(&self) -> String {
        "Complex Custom".to_string()
    }

    fn basic_translate(
        &self,
        num_bits: u64,
        value: &VariableValue,
    ) -> (String, ValueKind) {
        match value {
            VariableValue::BigUint(v) => {
                // Converte para string binária com zeros à esquerda
                let bin = Self::biguint_to_bin_str(v, num_bits);

                // Precisamos ter pelo menos 16 bits para nbm e nbe ambos de 8 bits.
                if bin.len() < 16 {
                    return ("<len<16>".to_string(), ValueKind::Normal);
                }
                // Extrai primeiros 8 bits para nbm, próximos 8 bits para nbe
                let ma_str = &bin[0..8];
                let ex_str = &bin[8..16];
                // Converte nbm e nbe
                let nbm = usize::from_str_radix(ma_str, 2).unwrap_or(0);
                let nbe = usize::from_str_radix(ex_str, 2).unwrap_or(0);
                let nbits = nbm + nbe + 1;
                // Verifica se comprimento coincide: total esperado = 16 + 2*nbits
                let expected = 16 + 2 * nbits;
                if bin.len() < expected {
                    // Não há bits suficientes: retorna indicação
                    return (format!("<len<{}>", expected), ValueKind::Normal);
                }
                // Extrai parte real e imaginária
                let re_str = &bin[16..16 + nbits];
                let im_str = &bin[16 + nbits..16 + 2 * nbits];
                // Dentro de re_str/im_str: primeiro bit sinal, próximos nbe bits expoente, últimos nbm bits mantissa
                if re_str.len() < 1 + nbe + nbm || im_str.len() < 1 + nbe + nbm {
                    return ("<sub-len-incorreto>".to_string(), ValueKind::Normal);
                }
                let sign_re = &re_str[0..1];
                let expo_re = &re_str[1..1 + nbe];
                let mant_re = &re_str[1 + nbe..1 + nbe + nbm];
                let sign_im = &im_str[0..1];
                let expo_im = &im_str[1..1 + nbe];
                let mant_im = &im_str[1 + nbe..1 + nbe + nbm];
                // Decodifica floats
                let fre = Self::decode_custom_float(sign_re, expo_re, mant_re);
                let fim = Self::decode_custom_float(sign_im, expo_im, mant_im);
                // Formata com três casas decimais (como no C: "%.3f %.3fi")
                let mut s = String::new();
                // Usa f64; ajustável para f32 se preferir
                // Note: pode-se querer organizar formato para alinhar sinal “+/-” etc.
                // Aqui: e.g. "1.234 5.678i" ou "-0.123 -4.567i"
                write!(&mut s, "{:.3} {:.3}i", fre, fim).ok();
                (s, ValueKind::Normal)
            }
            VariableValue::String(s_in) => {
                // Caso de valores não-binários (e.g., "X", "Z"): apenas repassa
                (s_in.clone(), ValueKind::Normal)
            }
        }
    }

    fn translates(
        &self,
        variable: &VariableMeta<VarId, ScopeId>,
    ) -> Result<TranslationPreference> {
        // Pode escolher aplicar apenas a sinais com largura >= 16, mas aqui liberamos para escolha manual
        let width = variable.num_bits;
        if width >= 16 {
            Ok(TranslationPreference::Yes)
        } else {
            Ok(TranslationPreference::No)
        }
    }

    // Opcional: se quiser fornecer info extra (e.g., tipo “Complex”), mas BasicTranslator já fornece default VariableInfo::... 
    // Para exibir um ícone específico, seria mais avançado; normalmente deixamos o default:
    // fn variable_info(&self, variable: &VariableMeta<VarId, ScopeId>) -> Result<VariableInfo> { ... }
}
