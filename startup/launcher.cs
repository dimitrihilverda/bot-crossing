// Een kruimel van een programma: het start de toggle en sluit zichzelf af.
//
// Waarom dit bestaat. De snelkoppeling wees eerst rechtstreeks naar powershell.exe, en
// Windows 11 biedt "Aan taakbalk vastmaken" niet aan voor snelkoppelingen naar systeemtools
// in System32 — powershell.exe en cmd.exe horen daarbij. Die actie ontbrak dus gewoon in het
// rechtsklikmenu, in het nieuwe menu én onder "Meer opties weergeven". Een eigen .exe is voor
// Windows een gewone toepassing, en daar mag je wel alles mee.
//
// Verder doet het niets: geen venster, geen console, geen wachten. Het zoekt het
// PowerShell-script naast zichzelf op, zodat de hele map verplaatsbaar blijft.

using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

static class Launcher
{
    [STAThread]
    static int Main(string[] args)
    {
        string here = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        string script = Path.Combine(here, "bot-crossing-toggle.ps1");

        if (!File.Exists(script))
        {
            MessageBox.Show(
                "Kan bot-crossing-toggle.ps1 niet vinden naast dit programma:\n" + here,
                "Moving-In Crossing", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }

        var psi = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + script + "\"",
            WorkingDirectory = Directory.GetParent(here).FullName,  // de repo-root
            UseShellExecute = false,
            CreateNoWindow = true,
        };

        try
        {
            Process.Start(psi);
        }
        catch (Exception e)
        {
            MessageBox.Show(
                "De toggle kon niet gestart worden:\n" + e.Message,
                "Moving-In Crossing", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        return 0;
    }
}
