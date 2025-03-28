# Pega parametros -------------------------------------------------------------

set    fileID  [open "tcl_infos.txt" r]
set   conteudo [read $fileID]
set    infos   [split  $conteudo "\n" ]
close $fileID

set linha      [lindex $infos 0 ]
set proc_list  [split $linha " "]

set linha      [lindex $infos 1 ]
set proc_type  [split $linha " "]

set tmp_dir    [lindex $infos 2 ]
set bin_dir    [lindex $infos 3 ]

# Loop nos processadores ------------------------------------------------------

set nfacs [gtkwave::getNumFacs]

set proc_indx 0
foreach proc $proc_list {

# Separador de processadores --------------------------------------------------

gtkwave::/Edit/Insert_Comment "###### $proc"

# Insere sinais ---------------------------------------------------------------

# insere clock
for {set i 0} {$i < $nfacs } {incr i} {
    set clk [gtkwave::getFacName $i]

    set  proc_id [string first $proc $clk]
    set  index   [string first core.clk $clk]
    if {$proc_id != -1 && $index != -1} break
}

# insere reset
for {set i 0} {$i < $nfacs } {incr i} {
    set rst [gtkwave::getFacName $i]

    set  proc_id [string first $proc $rst]
    set  index   [string first core.rst $rst]
    if {$proc_id != -1 && $index != -1} break
}

# insere interrupcao
for {set i 0} {$i < $nfacs } {incr i} {
    set itr [gtkwave::getFacName $i]

    set  proc_id [string first $proc $itr]
    set  index   [string first core.itr $itr]
    if {$proc_id != -1 && $index != -1} break
}

set filter [list $clk $rst $itr]
gtkwave::addSignalsFromList $filter

# Separador de I/O ------------------------------------------------------------

gtkwave::/Edit/Insert_Comment {I/O ****************}

# Sinais de entrada -----------------------------------------------------------

set j 0
set req_in [list]
set entrada [list]
for {set i 0} {$i < $nfacs } {incr i} {
    set facname [gtkwave::getFacName $i]

    set proc_id [string first $proc $facname]
    set index [string first "$proc.req_in_sim_" $facname]
    if {$proc_id != -1 && $index != -1} {
        lappend req_in $facname
        incr j
    }

    set index [string first "$proc.in_sim_" $facname]
    if {$proc_id != -1 && $index != -1} {
        lappend entrada $facname
    }
}

for {set i 0} {$i < $j } {incr i} {
    set filter [list [lindex $req_in $i]]
    gtkwave::addSignalsFromList $filter
    gtkwave::highlightSignalsFromList $filter
    gtkwave::/Edit/Color_Format/Yellow
    set nome [list req_in $i]
    gtkwave::/Edit/Alias_Highlighted_Trace $nome

    set filter [list [lindex $entrada $i]]
    gtkwave::addSignalsFromList $filter
    gtkwave::highlightSignalsFromList $filter
    gtkwave::/Edit/Data_Format/Signed_Decimal
    gtkwave::/Edit/Color_Format/Yellow
    set nome [list Input $i]
    gtkwave::/Edit/Alias_Highlighted_Trace $nome
}

# Sinais de saida -------------------------------------------------------------

set j 0
set out_en [list]
set saida [list]
for {set i 0} {$i < $nfacs } {incr i} {
    set facname [gtkwave::getFacName $i]

    set proc_id [string first $proc $facname]
    set index [string first "$proc.out_en_sim_" $facname]
    if {$proc_id != -1 && $index != -1} {
        lappend out_en $facname
        incr j
    }

    set index [string first "$proc.out_sig" $facname]
    if {$proc_id != -1 && $index != -1} {
        lappend saida $facname
    }
}

for {set i 0} {$i < $j } {incr i} {
    set filter [list [lindex $out_en $i]]
    gtkwave::addSignalsFromList $filter
    gtkwave::highlightSignalsFromList $filter
    gtkwave::/Edit/Color_Format/Yellow
    set nome [list out_en $i]
    gtkwave::/Edit/Alias_Highlighted_Trace $nome

    set filter [list [lindex $saida $i]]
    gtkwave::addSignalsFromList $filter
    gtkwave::highlightSignalsFromList $filter
    gtkwave::/Edit/Data_Format/Signed_Decimal
    gtkwave::/Edit/Color_Format/Yellow
    set nome [list Output $i]
    gtkwave::/Edit/Alias_Highlighted_Trace $nome
}

# Separador de Instrucoes -----------------------------------------------------

gtkwave::/Edit/Insert_Comment {Instructions *******}

# Assembly --------------------------------------------------------------------

set tradutor [gtkwave::setCurrentTranslateFile "$tmp_dir/[list [lindex $proc_type $proc_indx]]/trad_opcode.txt"]

for {set i 0} {$i < $nfacs } {incr i} {
    set facname [gtkwave::getFacName $i]

    set proc_id [string first $proc $facname]
    set index [string first pc.valr2 $facname]
    if {$proc_id != -1 && $index != -1} {
        set filter [list $facname]
        gtkwave::addSignalsFromList $filter
        gtkwave::highlightSignalsFromList $filter
        gtkwave::/Edit/Data_Format/Decimal
        gtkwave::/Edit/Color_Format/Indigo
        gtkwave::installFileFilter $tradutor
        gtkwave::/Edit/Alias_Highlighted_Trace Assembly
    }
}

# C+- -------------------------------------------------------------------------

set tradutor [gtkwave::setCurrentTranslateFile "$tmp_dir/[list [lindex $proc_type $proc_indx]]/trad_cmm.txt"]

for {set i 0} {$i < $nfacs } {incr i} {
    set facname [gtkwave::getFacName $i]

    set proc_id [string first $proc $facname]
    set index [string first pc.linetabs $facname]
    if {$proc_id != -1 && $index != -1} {
        set filter [list $facname]
        gtkwave::addSignalsFromList $filter
        gtkwave::highlightSignalsFromList $filter
        gtkwave::/Edit/Data_Format/Signed_Decimal
        gtkwave::/Edit/Color_Format/Violet
        gtkwave::installFileFilter $tradutor
        gtkwave::/Edit/Alias_Highlighted_Trace C+-
    }
}

# Separador de Variaveis ------------------------------------------------------

gtkwave::/Edit/Insert_Comment {Variables **********}

# Tipo int --------------------------------------------------------------------

set var_n 0
set var_int [list]
set var_int_func [list]
set var_int_name [list]
for {set i 0} {$i < $nfacs } {incr i} {
    set facname [gtkwave::getFacName $i]

    set proc_id [string first $proc $facname]
    set index [string first mdata.me1 $facname]
    if {$proc_id != -1 && $index != -1} {
        incr var_n
        lappend var_int $facname

        # pega funcao
        set findex [expr $index + 10]
        for {set j $findex} {$j < [string length $facname]} {incr j} {
            set char [string index $facname $j]
            if {[string compare $char "_"] == 0} {
                set lindex $j
                break
            }
        }
        set funcao [string range $facname $findex [expr $lindex -1]]
        lappend var_int_func $funcao

        # pega variavel
        set findex [expr $j + 1]
        for {set j $findex} {$j < [string length $facname]} {incr j} {
            set char [string index $facname $j]
            if {[string compare $char {[}] == 0} {
                set lindex $j
                break
            }
        }
        set variaveis [string range $facname $findex [expr $lindex -1]]
        lappend var_int_name $variaveis
	}
}

gtkwave::addSignalsFromList $var_int
gtkwave::/Edit/Data_Format/Signed_Decimal
gtkwave::/Edit/Color_Format/Orange
gtkwave::/Edit/UnHighlight_All

for {set i 0} {$i < $var_n} {incr i} {
    set facname [lindex $var_int $i]
    set target [list $facname]
    gtkwave::highlightSignalsFromList $target
    set name [lindex $var_int_name $i]
    set func [lindex $var_int_func $i]
    set ftmp [list int $name in $func]
    set par {()}
    if {[string compare $func global]==0} {
        gtkwave::/Edit/Alias_Highlighted_Trace $ftmp
    } else {
        gtkwave::/Edit/Alias_Highlighted_Trace $ftmp$par
    }
    gtkwave::/Edit/UnHighlight_All
}

# Tipo float ------------------------------------------------------------------

set var_n 0
set var_float [list]
set var_float_func [list]
set var_float_name [list]
for {set i 0} {$i < $nfacs } {incr i} {
    set facname [gtkwave::getFacName $i]

    set proc_id [string first $proc $facname]
    set index [string first mdata.me2 $facname]
    if {$proc_id != -1 && $index != -1} {
        incr var_n
        lappend var_float $facname

        # pega funcao
        set findex [expr $index + 10]
        for {set j $findex} {$j < [string length $facname]} {incr j} {
            set char [string index $facname $j]
            if {[string compare $char "_"] == 0} {
                set lindex $j
                break
            }
        }
        set funcao [string range $facname $findex [expr $lindex -1]]
        lappend var_float_func $funcao

        # pega variavel
        set findex [expr $j + 1]
        for {set j $findex} {$j < [string length $facname]} {incr j} {
            set char [string index $facname $j]
            if {[string compare $char {[}] == 0} {
                set lindex $j
                break
            }
        }
        set variaveis [string range $facname $findex [expr $lindex -1]]
        lappend var_float_name $variaveis
	}
}

set v_float [gtkwave::setCurrentTranslateProc $bin_dir/float2gtkw.exe]
gtkwave::addSignalsFromList $var_float
gtkwave::/Edit/Data_Format/Binary
gtkwave::/Edit/Color_Format/Orange
gtkwave::installProcFilter $v_float
gtkwave::/Edit/UnHighlight_All

for {set i 0} {$i < $var_n } {incr i} {
    set facname [lindex $var_float $i]
    set target [list $facname]
    gtkwave::highlightSignalsFromList $target
    set name [lindex $var_float_name $i]
    set func [lindex $var_float_func $i]
    set ftmp [list float $name in $func]
    set par {()}
    if {[string compare $func global]==0} {
        gtkwave::/Edit/Alias_Highlighted_Trace $ftmp
    } else {
        gtkwave::/Edit/Alias_Highlighted_Trace $ftmp$par
    }
    gtkwave::/Edit/UnHighlight_All
}

# Tipo comp -------------------------------------------------------------------

set var_n 0
set var_comp [list]
set var_comp_func [list]
set var_comp_name [list]
for {set i 0} {$i < $nfacs } {incr i} {
    set facname [gtkwave::getFacName $i]

    set proc_id [string first $proc $facname]
    set index [string first mdata.comp_me3 $facname]
    if {$proc_id != -1 && $index != -1} {
        incr var_n
        lappend var_comp $facname

        # pega funcao
        set findex [expr $index + 15]
        for {set j $findex} {$j < [string length $facname]} {incr j} {
            set char [string index $facname $j]
            if {[string compare $char "_"] == 0} {
                set lindex $j
                break
            }
        }
        set funcao [string range $facname $findex [expr $lindex -1]]
        lappend var_comp_func $funcao

        # pega variavel
        set findex [expr $j + 1]
        for {set j $findex} {$j < [string length $facname]} {incr j} {
            set char [string index $facname $j]
            if {[string compare $char {[}] == 0} {
                set lindex $j
                break
            }
        }
        set variaveis [string range $facname $findex [expr $lindex -1]]
        lappend var_comp_name $variaveis
	}
}

set v_comp [gtkwave::setCurrentTranslateProc $bin_dir/comp2gtkw.exe]
gtkwave::addSignalsFromList $var_comp
gtkwave::/Edit/Data_Format/Binary
gtkwave::/Edit/Color_Format/Orange
gtkwave::installProcFilter $v_comp
gtkwave::/Edit/UnHighlight_All

for {set i 0} {$i < $var_n } {incr i} {
    set facname [lindex $var_comp $i]
    set target [list $facname]
    gtkwave::highlightSignalsFromList $target
    set name [lindex $var_comp_name $i]
    set func [lindex $var_comp_func $i]
    set ftmp [list comp $name in $func]
    set par {()}
    if {[string compare $func global]==0} {
        gtkwave::/Edit/Alias_Highlighted_Trace $ftmp
    } else {
        gtkwave::/Edit/Alias_Highlighted_Trace $ftmp$par
    }
    gtkwave::/Edit/UnHighlight_All
}  

incr proc_indx

}

# Visualizacao ----------------------------------------------------------------

gtkwave::/Time/Zoom/Zoom_Best_Fit
gtkwave::/View/Left_Justified_Signals