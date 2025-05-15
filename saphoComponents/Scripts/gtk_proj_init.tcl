# funcoes de controle ---------------------------------------------------------

# pega o primeiro Fac com o padrao de texto dado
proc getFac {padrao proc} {
    for {set i 0} {$i < [gtkwave::getNumFacs]} {incr i} {
        set facname [gtkwave::getFacName $i]
        if {[string first $proc $facname] != -1 && [string first $padrao $facname] != -1} {return $facname}
    }
    return ""
}

# lista todas as Facs com o mesmo padrao de texto dado
proc listFac {padrao proc} {
    set lista [list]
    for {set i 0} {$i < [gtkwave::getNumFacs]} {incr i} {
        set facname [gtkwave::getFacName $i]
        if {[string first $proc $facname] != -1 && [string first $padrao $facname] != -1} {lappend lista $facname}
    }
    return $lista
}

# adiciona uma Fac
proc addFac {facname dataFormat color alias tradutor filter} {
    gtkwave::addSignalsFromList $facname
    gtkwave::/Edit/Data_Format/$dataFormat
    if {![string equal $tradutor ""]} {gtkwave::installFileFilter [gtkwave::setCurrentTranslateFile $tradutor]}
    if {![string equal $filter   ""]} {gtkwave::installProcFilter [gtkwave::setCurrentTranslateProc $filter  ]}
    gtkwave::/Edit/Color_Format/$color
    gtkwave::/Edit/Alias_Highlighted_Trace $alias
}

# adiciona uma variavel de acordo com o tipo de dado
proc addVar {padrao proc tipo dataFormat filter} {
    set var_typ [listFac $padrao $proc]
    
    for {set i 0} {$i < [llength $var_typ] } {incr i} {
        set facname [lindex $var_typ $i]
        regexp {_f_(.*?)_v_} $facname -> funcao
        regexp {_v_(.*?)_e_} $facname -> var
        if {[string compare $funcao global]!=0} {append funcao "()"}
        addFac $facname $dataFormat "Orange" [list $tipo $var in $funcao] "" $filter
    }
}

# Pega parametros -------------------------------------------------------------

set    fileID [open "tcl_infos.txt" r]
gets  $fileID  proc_list
gets  $fileID  proc_type
gets  $fileID  tmp_dir
gets  $fileID  bin_dir
close $fileID

# Loop nos processadores ------------------------------------------------------

set proc_indx 0
foreach proc $proc_list {

# Separador de processadores --------------------------------------------------

gtkwave::/Edit/Insert_Comment "###### $proc"

# Insere sinais ---------------------------------------------------------------

set clk [getFac "core.clk" $proc]
set rst [getFac "core.rst" $proc]
set itr [getFac "core.itr" $proc]

gtkwave::addSignalsFromList [list $clk $rst $itr]

# Separador de I/O ------------------------------------------------------------

gtkwave::/Edit/Insert_Comment {I/O ****************}

# Sinais de entrada -----------------------------------------------------------

set req_in  [listFac "$proc.req_in_sim" $proc]
set entrada [listFac "$proc.in_sim"     $proc]

for {set i 0} {$i < [llength $req_in] } {incr i} {
    addFac [list [lindex $req_in  $i]] "Binary"         "Yellow" "req_in $i" "" ""
    addFac [list [lindex $entrada $i]] "Signed_Decimal" "Yellow" "input  $i" "" ""
}

# Sinais de saida -------------------------------------------------------------

set out_en  [listFac "$proc.out_en_sim" $proc]
set saida  [listFac "$proc.out_sig"     $proc]

for {set i 0} {$i < [llength $out_en] } {incr i} {
    addFac [list [lindex $out_en  $i]] "Binary"         "Yellow" "out_en $i" "" ""
    addFac [list [lindex $saida   $i]] "Signed_Decimal" "Yellow" "output $i" "" ""
}

# Separador de Instrucoes -----------------------------------------------------

gtkwave::/Edit/Insert_Comment {Instructions *******}

# Assembly --------------------------------------------------------------------

addFac [getFac "$proc.valr2" $proc] "Decimal" "Indigo" "Assembly" "$tmp_dir/[list [lindex $proc_type $proc_indx]]/trad_opcode.txt" ""

# C+- -------------------------------------------------------------------------

addFac [getFac "$proc.linetabs" $proc] "Signed_Decimal" "Violet" "C+-" "$tmp_dir/[list [lindex $proc_type $proc_indx]]/trad_cmm.txt" ""

# Separador de Variaveis ------------------------------------------------------

gtkwave::/Edit/Insert_Comment {Variables **********}

# Tipo int --------------------------------------------------------------------

addVar "$proc.me1" $proc "int" "Signed_Decimal" ""

# Tipo float ------------------------------------------------------------------

addVar "$proc.me2" $proc "float" "Binary" "$bin_dir/float2gtkw.exe"

# Tipo comp -------------------------------------------------------------------

addVar "$proc.comp_me3" $proc "comp" "Binary" "$bin_dir/comp2gtkw.exe"

# Fim do loop´de procassadores ------------------------------------------------ 

incr proc_indx

}

# Visualizacao ----------------------------------------------------------------

gtkwave::/Time/Zoom/Zoom_Best_Fit
gtkwave::/View/Left_Justified_Signals