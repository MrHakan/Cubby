using UnityEngine;
using UnityEngine.SceneManagement;

public class GameMenu : MonoBehaviour
{
    [SerializeField] private GameObject infoText;
    public void PlayButton() { SceneManager.LoadScene(SceneManager.GetActiveScene().buildIndex + 1); }   
    public void QuitButton() { Application.Quit(); }
    public void InfoButton() { infoText.SetActive(true); }
    public void CloseInfoButton() { infoText.SetActive(false); }
    public void DiscordButton() { Application.OpenURL("https://discord.com/invite/nrdxEAw"); }
}
