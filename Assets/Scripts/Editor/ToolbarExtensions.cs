using UnityEditor;
using UnityEngine.SceneManagement;
using UnityEngine;
using UnityToolbarExtender;

[InitializeOnLoad]
public static class ToolbarExtensions
{
    static ToolbarExtensions()
    {
        ToolbarExtender.LeftToolbarGUI.Add(DrawLeftGUI);
    }
    static void DrawLeftGUI()
    {
        GUILayout.FlexibleSpace();
        if (GUILayout.Button(new GUIContent("-1","-1 Scene in build index")))
        {
            if (SceneManager.GetActiveScene().buildIndex - 1 < 0)
            {
                Debug.Log("You can't go to negative scene");
            }
            else
            {
                SceneManager.LoadScene(SceneManager.GetActiveScene().buildIndex - 1);
            }
        }
        if (GUILayout.Button(new GUIContent("+1", "+1 Scene in build index")))
        {
            if (SceneManager.GetActiveScene().buildIndex + 1 > SceneManager.sceneCountInBuildSettings)
            {
                Debug.Log("Build index null");
            }
            else
            {
                SceneManager.LoadScene(SceneManager.GetActiveScene().buildIndex + 1);
            }
        }
    }
}