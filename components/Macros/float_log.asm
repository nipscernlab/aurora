
// Natural logarithm ----------------------------------------------------------
// log(x) = e*ln2 + log(m),  e = XPO(x) = floor(log2 x),  m = x*2^-e in [1,2).
// O(1): e via XPO, m via a single F_SCL (no halve/double loop). log(m) is the
// atanh series 2u(1 + u^2/3 + u^4/5 + u^6/7 + u^8/9), u = (m-1)/(m+1).
// x <= 0 returns 0.

@float_log  SET   log_x                 // save x (acc still = x)
            F_LES 0.0                    // (x > 0) ?   [F_LES true when acc > X]
            JIZ   L_log_zero             // x <= 0 -> bail out with 0

            LOD   log_x
            XPO                          // e = floor(log2 x)   (int)
            SET   log_e
            NEG                          // -e
            SET   log_ne
            LOD   log_x
            F_SCL log_ne                 // m = x * 2^(-e)  -> [1,2)
            SET   log_m

            F_ADD 1.0                    // m+1   (acc still = m)
            SET   log_t2
            LOD   log_m
            F_SU1 1.0                    // m-1   (acc - X)
            SET   log_t1
            LOD   log_t2
            F_DIV log_t1                 // u = (m-1)/(m+1)   [F_DIV X = X/acc]
            SET   log_u
            F_MLT log_u
            SET   log_w                  // w = u^2

            LOD   0.1111111111           // Horner in w (1/9, 1/7, 1/5, 1/3, 1)
            F_MLT log_w
            F_ADD 0.1428571429
            F_MLT log_w
            F_ADD 0.2
            F_MLT log_w
            F_ADD 0.3333333333
            F_MLT log_w
            F_ADD 1.0
            F_MLT log_u
            F_MLT 2.0                     // log(m)
            SET   log_lm

            LOD   log_e
            I2F                           // float(e)
            F_MLT 0.6931471806            // e * ln2
            F_ADD log_lm                  // + log(m)  -> log(x)
            RET

@L_log_zero LOD   0.0
            RET
