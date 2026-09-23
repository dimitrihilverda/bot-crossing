# Geeft een snelkoppeling een eigen AppUserModelID.
#
# Waarom: het doel van de toggle-snelkoppeling is powershell.exe. Windows leidt de identiteit
# van een vastgemaakte knop af uit dat doel, en dan valt hij terug op het icoon en de groepering
# van PowerShell zelf in plaats van het icoon dat in de snelkoppeling staat — vastmaken aan de
# taakbalk levert dan een vreemd icoon op. Een eigen AppUserModelID maakt er voor Windows een
# losse app van: eigen icoon, eigen plek in de taakbalk, niet gegroepeerd met andere
# PowerShell-vensters.
#
# Gebruik:  .\set-appid.ps1 -Lnk 'C:\...\Moving-In Crossing.lnk' -AppId 'MovingIn.Crossing.Toggle'
param(
    [Parameter(Mandatory)][string]$Lnk,
    [Parameter(Mandatory)][string]$AppId
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path $Lnk)) { throw "snelkoppeling niet gevonden: $Lnk" }

# De shell zet dit als een property op het .lnk-bestand; dat kan alleen via IPropertyStore.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace BchShortcut {

  [StructLayout(LayoutKind.Sequential, Pack = 4)]
  public struct PropertyKey {
    public Guid fmtid;
    public uint pid;
    public PropertyKey(Guid g, uint p) { fmtid = g; pid = p; }
  }

  // PROPVARIANT is 24 bytes op x64 (vt + 6 gereserveerd + een union van 16). Kleiner
  // opgeven laat COM buiten de struct schrijven en de waarde komt niet aan.
  [StructLayout(LayoutKind.Explicit, Size = 24)]
  public struct PropVariant {
    [FieldOffset(0)] public ushort vt;
    [FieldOffset(8)] public IntPtr p;
  }

  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"),
   InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPropertyStore {
    void GetCount(out uint c);
    void GetAt(uint i, out PropertyKey key);
    void GetValue(ref PropertyKey key, out PropVariant pv);
    void SetValue(ref PropertyKey key, ref PropVariant pv);
    void Commit();
  }

  [ComImport, Guid("0000010B-0000-0000-C000-000000000046"),
   InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPersistFile {
    void GetClassID(out Guid id);
    [PreserveSig] int IsDirty();
    void Load([MarshalAs(UnmanagedType.LPWStr)] string file, uint mode);
    void Save([MarshalAs(UnmanagedType.LPWStr)] string file, [MarshalAs(UnmanagedType.Bool)] bool remember);
    void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string file);
    void GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string file);
  }

  [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
  public class ShellLink { }

  public static class AppId {
    // PKEY_AppUserModel_ID
    static readonly Guid Fmt = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");

    public static void Set(string lnk, string appId) {
      var link = (IPersistFile)new ShellLink();
      link.Load(lnk, 2 /* STGM_READWRITE */);

      var store = (IPropertyStore)link;
      var key = new PropertyKey(Fmt, 5);
      var pv = new PropVariant();
      pv.vt = 31; // VT_LPWSTR
      pv.p = Marshal.StringToCoTaskMemUni(appId);
      try {
        store.SetValue(ref key, ref pv);
        store.Commit();
        link.Save(lnk, true);
      } finally {
        Marshal.FreeCoTaskMem(pv.p);
      }
    }

    public static string Get(string lnk) {
      var link = (IPersistFile)new ShellLink();
      link.Load(lnk, 0 /* STGM_READ */);
      var store = (IPropertyStore)link;
      var key = new PropertyKey(Fmt, 5);
      PropVariant pv;
      store.GetValue(ref key, out pv);
      if (pv.vt != 31 || pv.p == IntPtr.Zero) return null;
      return Marshal.PtrToStringUni(pv.p);
    }
  }
}
'@

[BchShortcut.AppId]::Set($Lnk, $AppId)
$check = [BchShortcut.AppId]::Get($Lnk)
if ($check -eq $AppId) { "AppUserModelID gezet: $check" }
else { throw "AppUserModelID niet vastgelegd (gelezen: '$check')" }
