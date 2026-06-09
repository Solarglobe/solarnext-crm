# Télécharge les 2 images Maison Francis Kurkdjian
$folder = Split-Path -Parent $MyInvocation.MyCommand.Path

$images = @{
    "grand_soir_mfk.jpg"      = "https://fimgs.net/mdimg/perfume-thumbs/375x500.40816.jpg"
    "oud_satin_mood_mfk.jpg"  = "https://fimgs.net/mdimg/perfume-thumbs/375x500.30352.jpg"
}

foreach ($file in $images.Keys) {
    $url  = $images[$file]
    $dest = Join-Path $folder $file
    try {
        Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
        Write-Host "OK : $file"
    } catch {
        Write-Host "Erreur : $file — $_"
    }
}

Write-Host ""
Write-Host "Terminé ! Recharge le guide dans Chrome."
Read-Host "Appuie sur Entrée pour fermer"
