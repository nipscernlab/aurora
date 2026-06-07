
// Exponential function -------------------------------------------------------
// exp(x) = 2^n * exp(r),  n = round(x/ln2),  r = x - n*ln2 in [-ln2/2, ln2/2].
// O(1): n via F2I (round-to-nearest with a sign-half bias, since F2I truncates),
// 2^n via a single F_SCL (no loop). exp(r) is a degree-6 Taylor polynomial.

@float_exp  SET   exp_x                 // save x
            F_MLT 1.4426950409          // q = x / ln2   (1/ln2 = log2 e)
            SET   exp_q
            LOD   0.5
            F_SGN exp_q                 // copysign(0.5, q)
            F_ADD exp_q                 // q + copysign(0.5,q)
            F2I                         // n = round(q)   (F2I truncates toward 0)
            SET   exp_n
            I2F                         // float(n)
            F_MLT 0.6931471806          // n * ln2
            F_SU2 exp_x                 // r = x - n*ln2   (F_SU2 X = X - acc)
            SET   exp_r

            LOD   0.0013888889          // Horner, exp(r) = sum r^k/k! (k=0..6)
            F_MLT exp_r                 // 1/6!
            F_ADD 0.0083333333          // 1/5!
            F_MLT exp_r
            F_ADD 0.0416666667          // 1/4!
            F_MLT exp_r
            F_ADD 0.1666666667          // 1/3!
            F_MLT exp_r
            F_ADD 0.5                    // 1/2!
            F_MLT exp_r
            F_ADD 1.0                    // 1/1!
            F_MLT exp_r
            F_ADD 1.0                    // 1/0!  -> exp(r)
            F_SCL exp_n                  // * 2^n  -> exp(x)
            RET
