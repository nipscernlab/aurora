# =====================================================================================
#  aurora-prompt.ps1 - themed PowerShell prompt for the AURORA TCMD terminal.
#
#  Loaded ONLY into the embedded TCMD session (see main/ipc/shell.js): the shell is
#  launched with -EncodedCommand running a tiny bootstrap that reads this file's TEXT
#  and dot-sources it as a scriptblock. That means:
#    - the user's global $PROFILE is never touched (isolated to the app's shell);
#    - it is NOT subject to the script-file ExecutionPolicy (it runs as command text,
#      not as an executed .ps1), so Restricted / RemoteSigned machines still get it.
#
#  Colours are the exact aurora hexes the xterm.js theme already uses
#  (js/terminal/shell_terminal.js _theme), emitted as 24-bit truecolor ANSI -
#  ConPTY and xterm.js both speak it.
#
#  NOTE ON ENCODING: this file is kept pure ASCII on purpose. Windows PowerShell 5.1
#  reads BOM-less files in the system ANSI codepage, which would corrupt any literal
#  Unicode glyph. So every glyph below is built from its codepoint via [char]0x....,
#  and we flip the console output to UTF-8 once at load so xterm.js decodes them.
#
#  Segments (left -> right): active processor . directory . git branch + state,
#  then a second line with the input marker (accent chevron on success, red on fail).
# =====================================================================================

# Emit UTF-8 so the box-drawing / chevron glyphs render in xterm.js. Runs once on
# dot-source (top-level statement); harmless if the host disallows it.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
try { $OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

function prompt {
    # Capture the last command's outcome BEFORE anything below (git calls clobber
    # both $? and $LASTEXITCODE).
    $ok   = $?
    $code = $LASTEXITCODE

    try {
        $e   = [char]27
        $R   = "$e[0m"
        $dim = "$e[2m"
        $cAccent = "$e[38;2;142;131;232m"   # #8E83E8 violet  (accent)
        $cMint   = "$e[38;2;95;224;176m"    # #5FE0B0 mint    (git clean)
        $cTeal   = "$e[38;2;79;211;194m"    # #4FD3C2 teal    (processor)
        $cAmber  = "$e[38;2;232;201;125m"   # #E8C97D amber   (git dirty)
        $cRed    = "$e[38;2;226;108;108m"   # #E26C6C red     (failure)
        $cText   = "$e[38;2;156;161;174m"   # #9CA1AE text-secondary (dir)
        $cMuted  = "$e[38;2;106;111;124m"   # #6A6F7C text-muted (separators)

        # Glyphs by codepoint (keeps this file ASCII; see header note).
        $gChevron = [char]0x276F   # >  heavy right-angle  (input marker)
        $gCheck   = [char]0x2714   # v  check              (git clean)
        $gDot     = [char]0x25CF   # o  filled circle      (git dirty)
        $gProc    = [char]0x25B8   # >  small triangle     (processor)
        $gCross   = [char]0x2718   # x  ballot X           (failed exit)
        $gMid     = [char]0x00B7   # .  middle dot         (separator)

        $sep  = "$cMuted$dim  $gMid  $R"
        $segs = @()

        # --- active processor (fed live by the app via AURORA_SHELL_CONTEXT) -------
        $proc = ''
        $ctxPath = $env:AURORA_SHELL_CONTEXT
        if ($ctxPath -and (Test-Path -LiteralPath $ctxPath)) {
            try {
                $ctx = Get-Content -Raw -Encoding UTF8 -LiteralPath $ctxPath -ErrorAction Stop | ConvertFrom-Json
                if ($ctx.processor) { $proc = [string]$ctx.processor }
            } catch { }
        }
        if ($proc) { $segs += "$cTeal$gProc $proc$R" }

        # --- current directory (~ for home) ---------------------------------------
        $path = $ExecutionContext.SessionState.Path.CurrentLocation.Path
        if ($HOME -and $path.StartsWith($HOME, [System.StringComparison]::OrdinalIgnoreCase)) {
            $path = '~' + $path.Substring($HOME.Length)
        }
        $segs += "$cText$path$R"

        # --- git branch + dirty state (single porcelain call) ----------------------
        $branch = ''
        $dirty  = $false
        if (Get-Command git -ErrorAction SilentlyContinue) {
            $raw = & git status --porcelain=v1 --branch 2>$null
            if ($LASTEXITCODE -eq 0 -and $raw) {
                $lines  = @($raw)
                $head   = [string]$lines[0]
                $branch = $head -replace '^## ', '' -replace '\.\.\..*$', '' -replace ' .*$', ''
                if ($branch -like 'No*') { $branch = 'no commits' }  # "## No commits yet on X"
                $dirty  = $lines.Count -gt 1
            }
        }
        if ($branch) {
            if ($dirty) { $segs += "$cAmber$branch $gDot$R" }
            else        { $segs += "$cMint$branch $gCheck$R" }
        }

        $line1 = [string]::Join($sep, $segs)

        # --- input marker: accent chevron on success, red on failure ---------------
        if ($ok) {
            $mark = "$cAccent$gChevron$R"
        } else {
            $tag = ''
            if ($code -and $code -ne 0) { $tag = "$cRed$gCross $code $R" }
            $mark = "$tag$cRed$gChevron$R"
        }

        # Restore the exit code the user's command produced (our git call above
        # overwrote $LASTEXITCODE).
        $global:LASTEXITCODE = $code

        return "`n$line1`n$mark "
    } catch {
        # Never leave the user without a working prompt.
        return "PS $($ExecutionContext.SessionState.Path.CurrentLocation)> "
    }
}
