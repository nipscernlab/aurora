
// Tangent function -----------------------------------------------------------
// tan has period pi, so x is reduced to r = x - round(x/pi)*pi in [-pi/2, pi/2].
// Since +-pi/2 are poles, r is folded into [0, pi/4] with the cotangent identity
// tan(r) = 1/tan(pi/2 - |r|) for |r| > pi/4, and one shared degree-11 odd minimax
// polynomial (least-squares fit of tan(u)/u on [0, pi/4], max abs error ~6.5e-7)
// serves both branches. tan is odd, so the sign of r is applied at the end with
// F_SGN. No lookup table, no new hardware.
// NB: F2I truncates toward zero, so round-to-nearest uses a sign-half bias.

@float_tan  SET   tan_x                  // save x
            F_MLT 0.3183098862           // q = x / pi   (1/pi)
            SET   tan_q
            LOD   0.5
            F_SGN tan_q                  // copysign(0.5, q)
            F_ADD tan_q                  // q + copysign(0.5,q)
            F2I                          // k = round(q)
            I2F                          // float(k)
            F_MLT 3.1415926536           // k * pi
            F_SU2 tan_x                  // r = x - k*pi  -> [-pi/2, pi/2]  (F_SU2 X = X - acc)
            SET   tan_r
            F_ABS                        // a = |r|
            SET   tan_a
            F_LES 0.785398163            // a > pi/4 ?  [F_LES true when acc > X]
            SET   tan_fold               // flag: 1 -> cotangent branch
            JIZ   L_tan_inner
            LOD   tan_a                  // outer branch: u = pi/2 - a   (u in [0,pi/4))
            F_SU2 1.5707963268           // pi/2 - a   (F_SU2 X = X - acc)
            JMP   L_tan_haveU
@L_tan_inner LOD  tan_a                  // inner branch: u = a
@L_tan_haveU SET  tan_u

            F_MLT tan_u                  // w = u^2
            SET   tan_w
            LOD   0.019691612742         // Horner in w: tan(u)/u = a1 + a3 w + ... + a11 w^5
            F_MLT tan_w                  // a11
            F_ADD 0.013512594373         // a9
            F_MLT tan_w
            F_ADD 0.056704928952         // a7
            F_MLT tan_w
            F_ADD 0.132942907215         // a5
            F_MLT tan_w
            F_ADD 0.333353228230         // a3
            F_MLT tan_w
            F_ADD 0.999999838962         // a1
            F_MLT tan_u                  // * u  -> tan(u) = P  (>= 0)
            SET   tan_p

            LOD   tan_fold
            JIZ   L_tan_done             // a <= pi/4 -> tan = P
            LOD   tan_p                  // a > pi/4  -> tan = 1/P  (cotangent)
            F_DIV 1.0                    // 1.0 / P   (F_DIV X = X/acc)
            JMP   L_tan_sign
@L_tan_done LOD  tan_p
@L_tan_sign F_SGN tan_r                  // tan is odd -> apply the sign of r
            RET
