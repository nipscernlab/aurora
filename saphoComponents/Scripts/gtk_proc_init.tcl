# funcoes de controle ---------------------------------------------------------

# pega o primeiro Fac com o padrao de texto dado
proc getFac {padrao} {
    for {set i 0} {$i < [gtkwave::getNumFacs]} {incr i} {
        set facname [gtkwave::getFacName $i]
        if {[string first $padrao $facname] != -1} {return $facname}
    }
    return ""
}

# lista todas as Facs com o mesmo padrao de texto dado
proc listFac {padrao} {
    set lista [list]
    for {set i 0} {$i < [gtkwave::getNumFacs]} {incr i} {
        set facname [gtkwave::getFacName $i]
        if {[string first $padrao $facname] != -1} {lappend lista $facname}
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
proc addVar {padrao tipo dataFormat filter} {
    set var_typ [listFac $padrao]
    
    for {set i 0} {$i < [llength $var_typ] } {incr i} {
        set facname [lindex $var_typ $i]
        regexp {_f_(.*?)_v_} $facname -> funcao
        regexp {_v_(.*?)_e_} $facname -> var
        if {[string compare $funcao global]!=0} {append funcao "()"}
        addFac $facname $dataFormat "Orange" "$tipo $var in $funcao" "" $filter
    }
}

# Pega infos do processador ---------------------------------------------------

set    fileID [open "tcl_infos.txt" r]
gets  $fileID tmp_dir
gets  $fileID bin_dir
close $fileID

# Insere sinais basicos -------------------------------------------------------

set clk      [getFac "core.clk" ]
set rst      [getFac "core.rst" ]

gtkwave::addSignalsFromList [list $clk $rst]

# Separador de I/O ------------------------------------------------------------

gtkwave::/Edit/Insert_Comment {I/O ****************}

# Sinais de entrada -----------------------------------------------------------

set req_in  [listFac "req_in_sim"]
set entrada [listFac "in_sim"    ]

for {set i 0} {$i < [llength $req_in] } {incr i} {
    addFac [list [lindex $req_in  $i]] "Binary"         "Yellow" "req_in $i" "" ""
    addFac [list [lindex $entrada $i]] "Signed_Decimal" "Yellow" "input  $i" "" ""
}

# Sinais de saida -------------------------------------------------------------

set out_en [listFac "out_en_sim"]
set saida  [listFac "out_sig"   ]

for {set i 0} {$i < [llength $out_en] } {incr i} {
    addFac [list [lindex $out_en $i]] "Binary"         "Yellow" "out_en $i" "" ""
    addFac [list [lindex $saida  $i]] "Signed_Decimal" "Yellow" "output $i" "" ""
}

# Separador de Instrucoes -----------------------------------------------------

gtkwave::/Edit/Insert_Comment {Instructions *******}

# Assembly --------------------------------------------------------------------

addFac [getFac "proc.valr2"] "Decimal" "Indigo" "Assembly" "$tmp_dir/trad_opcode.txt" ""

# C+- -------------------------------------------------------------------------

addFac [getFac "proc.linetabs"] "Signed_Decimal" "Violet" "C+-" "$tmp_dir/trad_cmm.txt" ""

# Separador de Variaveis ------------------------------------------------------

gtkwave::/Edit/Insert_Comment {Variables **********}

# Tipo int --------------------------------------------------------------------

addVar "proc.me1" "int" "Signed_Decimal" ""

# Tipo float ------------------------------------------------------------------

addVar "proc.me2" "float" "Binary" "$bin_dir/float2gtkw.exe"

# Tipo comp -------------------------------------------------------------------

addVar "proc.comp_me3" "comp" "Binary" "$bin_dir/comp2gtkw.exe"

# Visualizacao ----------------------------------------------------------------

gtkwave::/Time/Zoom/Zoom_Best_Fit
gtkwave::/View/Left_Justified_Signals